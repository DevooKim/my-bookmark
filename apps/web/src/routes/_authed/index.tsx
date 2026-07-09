import type {
  Bookmark,
  CategoryWithCount,
  CreateBookmarkRequest,
} from "@my-bookmark/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Edit, MoreVertical, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ApiClientError,
  createBookmark,
  createCategory,
  createReminder,
  deleteBookmark,
  listBookmarks,
  listCategories,
  recategorizeBookmark,
  updateBookmark,
} from "../../lib/api-client";

export const Route = createFileRoute("/_authed/")({ component: HomePage });

function HomePage() {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [reminderTarget, setReminderTarget] = useState<Bookmark | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      300,
    );
    return () => window.clearTimeout(handle);
  }, [search]);

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: listCategories,
  });

  const bookmarksQuery = useInfiniteQuery({
    queryKey: ["bookmarks", { categoryId, q: debouncedSearch }],
    queryFn: ({ pageParam }) => {
      const params: { categoryId?: string; q?: string; cursor?: string } = {};
      if (categoryId) {
        params.categoryId = categoryId;
      }
      if (debouncedSearch) {
        params.q = debouncedSearch;
      }
      if (pageParam) {
        params.cursor = pageParam;
      }
      return listBookmarks(params);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: (query) => {
      const hasPending = query.state.data?.pages.some((page) =>
        page.items.some((bookmark) => bookmark.aiStatus === "pending"),
      );
      return hasPending ? 5000 : false;
    },
  });

  const bookmarks = useMemo(
    () => bookmarksQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [bookmarksQuery.data],
  );

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !bookmarksQuery.hasNextPage) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void bookmarksQuery.fetchNextPage();
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [bookmarksQuery.hasNextPage, bookmarksQuery.fetchNextPage]);

  const deleteMutation = useMutation({
    mutationFn: deleteBookmark,
    onSuccess: () => {
      toast.success("북마크를 삭제했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: () => toast.error("삭제하지 못했어요"),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      categoryId: nextCategoryId,
    }: {
      id: string;
      categoryId: string | null;
    }) => updateBookmark(id, { categoryId: nextCategoryId }),
    onSuccess: () => {
      toast.success("카테고리를 변경했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: () => toast.error("변경하지 못했어요"),
  });

  const recategorizeMutation = useMutation({
    mutationFn: recategorizeBookmark,
    onSuccess: () => {
      toast.success("AI 분류를 다시 시작했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
    },
    onError: () => toast.error("AI 분류를 시작하지 못했어요"),
  });

  const categories = categoriesQuery.data?.items ?? [];

  return (
    <main className="space-y-4">
      <section className="sticky top-[57px] z-[5] -mx-4 border-b border-zinc-200 bg-zinc-50 px-4 pb-4 pt-1 dark:border-zinc-800 dark:bg-zinc-950 sm:static sm:mx-0 sm:rounded-2xl sm:border sm:bg-white sm:p-5 sm:dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">북마크</h1>
            <p className="text-sm text-zinc-500">
              읽고 싶은 링크를 저장하고 분류하세요.
            </p>
          </div>
          <button
            className="btn-primary"
            onClick={() => setIsAddOpen(true)}
            type="button"
          >
            <Plus className="h-4 w-4" /> 추가
          </button>
        </div>

        <label className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="검색"
            value={search}
          />
        </label>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <CategoryChip
            active={!categoryId}
            label="전체"
            onClick={() => setCategoryId(undefined)}
          />
          <CategoryChip
            active={categoryId === "none"}
            label="미분류"
            onClick={() => setCategoryId("none")}
          />
          {categories.map((category) => (
            <CategoryChip
              active={categoryId === category.id}
              key={category.id}
              label={`${category.name}${category.bookmarkCount === undefined ? "" : ` ${category.bookmarkCount}`}`}
              onClick={() => setCategoryId(category.id)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        {bookmarks.map((bookmark) => (
          <BookmarkCard
            bookmark={bookmark}
            categories={categories}
            key={bookmark.id}
            onDelete={() => deleteMutation.mutate(bookmark.id)}
            onEdit={() => setEditing(bookmark)}
            onMove={(nextCategoryId) =>
              updateMutation.mutate({
                id: bookmark.id,
                categoryId: nextCategoryId,
              })
            }
            onRecategorize={() => recategorizeMutation.mutate(bookmark.id)}
            onSetReminder={() => setReminderTarget(bookmark)}
          />
        ))}

        {bookmarksQuery.isLoading ? (
          <p className="py-8 text-center text-zinc-500">불러오는 중…</p>
        ) : null}
        {!bookmarksQuery.isLoading && bookmarks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="font-medium">첫 북마크를 추가해보세요</p>
            <button
              className="btn-primary mx-auto mt-4"
              onClick={() => setIsAddOpen(true)}
              type="button"
            >
              <Plus className="h-4 w-4" /> 추가
            </button>
          </div>
        ) : null}

        <div ref={loadMoreRef} />
        {bookmarksQuery.hasNextPage ? (
          <button
            className="btn-secondary mx-auto"
            onClick={() => bookmarksQuery.fetchNextPage()}
            type="button"
          >
            더 보기
          </button>
        ) : null}
      </section>

      {isAddOpen ? (
        <BookmarkDialog
          categories={categories}
          onClose={() => setIsAddOpen(false)}
        />
      ) : null}
      {editing ? (
        <EditBookmarkDialog
          bookmark={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {reminderTarget ? (
        <ReminderDialog
          bookmark={reminderTarget}
          onClose={() => setReminderTarget(null)}
        />
      ) : null}
    </main>
  );
}

function CategoryChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "chip-active" : "chip"}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function BookmarkCard({
  bookmark,
  categories,
  onDelete,
  onEdit,
  onMove,
  onRecategorize,
  onSetReminder,
}: {
  bookmark: Bookmark;
  categories: CategoryWithCount[];
  onDelete: () => void;
  onEdit: () => void;
  onMove: (categoryId: string | null) => void;
  onRecategorize: () => void;
  onSetReminder: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const category = categories.find((item) => item.id === bookmark.categoryId);
  const title = bookmark.title ?? new URL(bookmark.url).hostname;

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex gap-3">
        <img
          alt=""
          className="mt-1 h-8 w-8 rounded-lg bg-zinc-100"
          src={
            bookmark.faviconUrl ??
            `https://www.google.com/s2/favicons?domain=${new URL(bookmark.url).hostname}&sz=64`
          }
        />
        <div className="min-w-0 flex-1">
          <a
            className="font-medium hover:text-blue-600"
            href={bookmark.url}
            rel="noreferrer"
            target="_blank"
          >
            {title}
          </a>
          <p className="mt-1 truncate text-sm text-zinc-500">
            {new URL(bookmark.url).hostname.replace(/^www\./, "")} ·{" "}
            {category?.name ?? "미분류"}
          </p>
          {bookmark.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
              {bookmark.description}
            </p>
          ) : null}
          {bookmark.aiStatus === "pending" ? (
            <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              분석중…
            </span>
          ) : null}
          {bookmark.aiStatus === "failed" ? (
            <span className="mt-2 inline-flex rounded-full bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
              AI 분류 실패
            </span>
          ) : null}
        </div>
        <div className="relative">
          <button
            aria-label="북마크 메뉴"
            className="icon-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 z-10 mt-2 w-48 rounded-xl border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <button className="menu-item" onClick={onEdit} type="button">
                <Edit className="h-4 w-4" /> 편집
              </button>
              <button
                className="menu-item"
                onClick={() => onMove(null)}
                type="button"
              >
                미분류로 변경
              </button>
              {categories.map((item) => (
                <button
                  className="menu-item"
                  key={item.id}
                  onClick={() => onMove(item.id)}
                  type="button"
                >
                  {item.name}
                </button>
              ))}
              {bookmark.aiStatus === "failed" ? (
                <button
                  className="menu-item"
                  onClick={onRecategorize}
                  type="button"
                >
                  AI 재분류
                </button>
              ) : null}
              <button
                className="menu-item"
                onClick={onSetReminder}
                type="button"
              >
                <Clock className="h-4 w-4" /> 리마인더
              </button>
              <button
                className="menu-item text-red-600"
                onClick={onDelete}
                type="button"
              >
                <Trash2 className="h-4 w-4" /> 삭제
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function BookmarkDialog({
  categories,
  onClose,
}: {
  categories: CategoryWithCount[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"ai" | "manual" | "none">(() => {
    const stored = localStorage.getItem("bookmarkMode");
    return stored === "ai" || stored === "manual" ? stored : "none";
  });
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [newCategoryName, setNewCategoryName] = useState("");
  const createCategoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      setCategoryId(category.id);
      setNewCategoryName("");
      toast.success("카테고리를 만들었어요");
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: () => toast.error("카테고리를 만들지 못했어요"),
  });
  const mutation = useMutation({
    mutationFn: createBookmark,
    onSuccess: () => {
      localStorage.setItem("bookmarkMode", mode);
      toast.success("북마크를 저장했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        toast.error("이미 저장된 링크예요");
        return;
      }
      toast.error("저장하지 못했어요");
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const body: CreateBookmarkRequest =
      mode === "manual"
        ? { url, mode, categoryId, title: title.trim() || null }
        : { url, mode, title: title.trim() || null };
    mutation.mutate(body);
  }

  return (
    <Dialog title="북마크 추가" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label="URL">
          <input
            className="input"
            onChange={(e) => setUrl(e.target.value)}
            required
            type="url"
            value={url}
          />
        </Field>
        <Field label="제목(선택)">
          <input
            className="input"
            onChange={(e) => setTitle(e.target.value)}
            value={title}
          />
        </Field>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <button
            className={mode === "ai" ? "chip-active" : "chip"}
            onClick={() => setMode("ai")}
            type="button"
          >
            AI 자동
          </button>
          <button
            className={mode === "manual" ? "chip-active" : "chip"}
            onClick={() => setMode("manual")}
            type="button"
          >
            직접 선택
          </button>
          <button
            className={mode === "none" ? "chip-active" : "chip"}
            onClick={() => setMode("none")}
            type="button"
          >
            미지정
          </button>
        </div>
        {mode === "manual" ? (
          <div className="space-y-3">
            <Field label="카테고리">
              <select
                className="input"
                onChange={(e) => setCategoryId(e.target.value)}
                required
                value={categoryId}
              >
                <option value="" disabled>
                  카테고리를 선택하세요
                </option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex gap-2">
              <input
                className="input"
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="새 카테고리 이름"
                value={newCategoryName}
              />
              <button
                className="btn-secondary shrink-0"
                disabled={
                  createCategoryMutation.isPending || !newCategoryName.trim()
                }
                onClick={() =>
                  createCategoryMutation.mutate({
                    name: newCategoryName,
                    color: "blue",
                  })
                }
                type="button"
              >
                새 카테고리
              </button>
            </div>
          </div>
        ) : null}
        <button
          className="btn-primary w-full justify-center"
          disabled={mutation.isPending || (mode === "manual" && !categoryId)}
          type="submit"
        >
          저장
        </button>
      </form>
    </Dialog>
  );
}

function EditBookmarkDialog({
  bookmark,
  onClose,
}: {
  bookmark: Bookmark;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(bookmark.title ?? "");
  const [description, setDescription] = useState(bookmark.description ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      updateBookmark(bookmark.id, {
        title: title || null,
        description: description || null,
      }),
    onSuccess: () => {
      toast.success("수정했어요");
      void queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      onClose();
    },
    onError: () => toast.error("수정하지 못했어요"),
  });
  return (
    <Dialog title="북마크 편집" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="제목">
          <input
            className="input"
            onChange={(e) => setTitle(e.target.value)}
            value={title}
          />
        </Field>
        <Field label="설명">
          <textarea
            className="input min-h-24"
            onChange={(e) => setDescription(e.target.value)}
            value={description}
          />
        </Field>
        <button
          className="btn-primary w-full justify-center"
          disabled={mutation.isPending}
          type="submit"
        >
          저장
        </button>
      </form>
    </Dialog>
  );
}

function ReminderDialog({
  bookmark,
  onClose,
}: {
  bookmark: Bookmark;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const defaultDate = new Date(Date.now() + 2 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  const [remindAt, setRemindAt] = useState(defaultDate);
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      createReminder({
        bookmarkId: bookmark.id,
        remindAt: new Date(remindAt).toISOString(),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success("리마인더를 만들었어요");
      void queryClient.invalidateQueries({ queryKey: ["reminders"] });
      onClose();
    },
    onError: () => toast.error("리마인더를 만들지 못했어요"),
  });
  return (
    <Dialog title="리마인더 설정" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <p className="truncate text-sm text-zinc-500">
          {bookmark.title ?? bookmark.url}
        </p>
        <Field label="알림 시간">
          <input
            className="input"
            min={new Date().toISOString().slice(0, 16)}
            onChange={(event) => setRemindAt(event.target.value)}
            required
            type="datetime-local"
            value={remindAt}
          />
        </Field>
        <Field label="메모(선택)">
          <textarea
            className="input min-h-20"
            onChange={(event) => setNote(event.target.value)}
            value={note}
          />
        </Field>
        <button
          className="btn-primary w-full justify-center"
          disabled={mutation.isPending}
          type="submit"
        >
          저장
        </button>
      </form>
    </Dialog>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
      <div className="w-full rounded-t-3xl bg-white p-5 shadow-xl dark:bg-zinc-900 sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            className="text-sm text-zinc-500"
            onClick={onClose}
            type="button"
          >
            닫기
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </div>
  );
}
