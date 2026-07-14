import type { Bookmark } from "@my-bookmark/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Edit, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteBookmark,
  getBookmark,
  listCategories,
  recategorizeBookmark,
} from "../../lib/api-client";
import { EditBookmarkDialog } from "./-components/bookmark-dialogs";
import { BookmarkMetadata } from "./-components/bookmark-metadata";

export const Route = createFileRoute("/_authed/images/$id")({
  component: ImageDetailPage,
});

const createdDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
});

function ImageDetailPage() {
  const { id } = Route.useParams();
  return <ImageDetailPageForId id={id} key={id} />;
}

function ImageDetailPageForId({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [mediaBroken, setMediaBroken] = useState(false);
  const mediaRetryAttempted = useRef(false);
  const resetMediaRecovery = () => {
    mediaRetryAttempted.current = false;
    setMediaBroken(false);
  };
  const bookmarkQuery = useQuery({
    queryKey: ["bookmark", id],
    queryFn: () => getBookmark(id),
    refetchInterval: (query) =>
      query.state.data?.aiStatus === "pending" ? 5000 : false,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });
  const recategorizeMutation = useMutation({
    mutationFn: () => recategorizeBookmark(id),
    onSuccess: () => {
      toast.success("AI 분석을 다시 시작했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmark", id] });
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
    },
    onError: () => toast.error("AI 분석을 시작하지 못했어요"),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteBookmark(id),
    onSuccess: () => {
      toast.success("이미지를 삭제했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void navigate({ to: "/" });
    },
    onError: () => toast.error("삭제하지 못했어요"),
  });

  if (bookmarkQuery.isLoading) {
    return (
      <p className="page-stack py-12 text-center text-zinc-500">불러오는 중…</p>
    );
  }
  const bookmark = bookmarkQuery.data;
  if (bookmark?.kind !== "image") {
    return (
      <main className="page-stack py-12 text-center">
        <p className="font-semibold">이미지 항목을 찾지 못했어요.</p>
        <a className="btn-secondary mx-auto mt-4" href="/">
          목록으로
        </a>
      </main>
    );
  }

  const categories = categoriesQuery.data?.items ?? [];
  const categoryName =
    categories.find((category) => category.id === bookmark.categoryId)?.name ??
    null;

  return (
    <>
      <ImageDetailView
        bookmark={bookmark}
        categoryName={categoryName}
        mediaBroken={mediaBroken}
        onDelete={() => {
          if (window.confirm("원본 이미지를 포함해 이 항목을 삭제할까요?")) {
            deleteMutation.mutate();
          }
        }}
        onEdit={() => setIsEditing(true)}
        onMediaError={() => {
          if (mediaRetryAttempted.current) {
            setMediaBroken(true);
            return;
          }
          mediaRetryAttempted.current = true;
          void bookmarkQuery.refetch();
        }}
        onMediaSourceChange={resetMediaRecovery}
        onRecategorize={() => recategorizeMutation.mutate()}
      />
      {isEditing ? (
        <EditBookmarkDialog
          bookmark={bookmark}
          categories={categories}
          onClose={() => {
            setIsEditing(false);
            void queryClient.invalidateQueries({ queryKey: ["bookmark", id] });
          }}
        />
      ) : null}
    </>
  );
}

export function ImageDetailView({
  bookmark,
  categoryName,
  mediaBroken = false,
  onDelete,
  onEdit,
  onMediaError,
  onMediaSourceChange,
  onRecategorize,
}: {
  bookmark: Extract<Bookmark, { kind: "image" }>;
  categoryName: string | null;
  mediaBroken?: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onMediaError: () => void;
  onMediaSourceChange: () => void;
  onRecategorize: () => void;
}) {
  const title = bookmark.title ?? bookmark.image.filename ?? "이미지";
  const [showOriginal, setShowOriginal] = useState(false);
  const mediaUrl = showOriginal
    ? bookmark.image.originalUrl
    : bookmark.image.thumbnailUrl;

  function toggleMediaSource() {
    onMediaSourceChange();
    setShowOriginal((current) => !current);
  }

  return (
    <main className="page-stack">
      <header className="flex items-center justify-between gap-3">
        <a className="btn-secondary" href="/">
          <ArrowLeft className="h-4 w-4" /> 목록
        </a>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary" onClick={onEdit} type="button">
            <Edit className="h-4 w-4" /> 편집
          </button>
          <button
            className="btn-secondary"
            disabled={bookmark.aiStatus === "pending"}
            onClick={onRecategorize}
            type="button"
          >
            <Sparkles className="h-4 w-4" /> AI 재분류
          </button>
          <button
            className="btn-secondary text-red-600"
            onClick={onDelete}
            type="button"
          >
            <Trash2 className="h-4 w-4" /> 삭제
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
        {mediaUrl && !mediaBroken ? (
          <img
            alt={title}
            className="mx-auto h-[70dvh] max-h-[48rem] w-full object-contain"
            onError={onMediaError}
            src={mediaUrl}
          />
        ) : (
          <div className="flex min-h-72 items-center justify-center px-6 text-center text-zinc-300">
            {showOriginal
              ? "원본 이미지를 불러오지 못했어요."
              : "미리보기를 불러오지 못했어요."}
          </div>
        )}
      </section>

      <section className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">
              이미지 · {categoryName ?? "미분류"}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {bookmark.image.originalUrl ? (
              <button
                className="btn-secondary"
                onClick={toggleMediaSource}
                type="button"
              >
                {showOriginal ? "미리보기로 돌아가기" : "원본 보기"}
              </button>
            ) : null}
            {showOriginal && bookmark.image.originalUrl && !mediaBroken ? (
              <a
                className="btn-secondary"
                download={bookmark.image.filename ?? "image"}
                href={bookmark.image.originalUrl}
              >
                <Download className="h-4 w-4" /> 원본 다운로드
              </a>
            ) : null}
          </div>
        </div>
        {bookmark.description ? (
          <p className="leading-7 text-zinc-600 dark:text-zinc-300">
            {bookmark.description}
          </p>
        ) : null}
        <BookmarkMetadata metadata={bookmark.metadata} />
        {bookmark.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {bookmark.tags.map((tag) => (
              <span className="chip" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-zinc-500">
          등록일 {createdDateFormatter.format(new Date(bookmark.createdAt))}
        </p>
      </section>
    </main>
  );
}
