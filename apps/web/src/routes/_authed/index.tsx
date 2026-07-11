import type { Bookmark, CategoryWithCount } from "@my-bookmark/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Clock, Edit, MoreVertical, Plus, Search, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteBookmark,
  listBookmarks,
  listCategories,
  recategorizeBookmark,
  updateBookmark,
} from "../../lib/api-client";

const BookmarkDialog = lazy(() =>
  import("./-components/bookmark-dialogs").then((module) => ({
    default: module.BookmarkDialog,
  })),
);
const EditBookmarkDialog = lazy(() =>
  import("./-components/bookmark-dialogs").then((module) => ({
    default: module.EditBookmarkDialog,
  })),
);
const ReminderDialog = lazy(() =>
  import("./-components/bookmark-dialogs").then((module) => ({
    default: module.ReminderDialog,
  })),
);

export const Route = createFileRoute("/_authed/")({ component: HomePage });

export function HomePage() {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [reminderTarget, setReminderTarget] = useState<Bookmark | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
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

  const virtualizer = useWindowVirtualizer({
    count: bookmarks.length,
    estimateSize: () => 124,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    getItemKey: (index) => bookmarks[index]?.id ?? index,
  });

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

      <section>
        <div
          className="relative"
          ref={listRef}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const bookmark = bookmarks[virtualItem.index];
            if (!bookmark) {
              return null;
            }
            return (
              <div
                className="absolute left-0 top-0 w-full pb-3 focus-within:z-10"
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{
                  transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <BookmarkCard
                  bookmark={bookmark}
                  categories={categories}
                  onDelete={() => deleteMutation.mutate(bookmark.id)}
                  onEdit={() => setEditing(bookmark)}
                  onMove={(nextCategoryId) =>
                    updateMutation.mutate({
                      id: bookmark.id,
                      categoryId: nextCategoryId,
                    })
                  }
                  onRecategorize={() =>
                    recategorizeMutation.mutate(bookmark.id)
                  }
                  onSetReminder={() => setReminderTarget(bookmark)}
                  onTagSearch={setSearch}
                />
              </div>
            );
          })}
        </div>

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
            className="btn-secondary mx-auto mt-3"
            onClick={() => bookmarksQuery.fetchNextPage()}
            type="button"
          >
            더 보기
          </button>
        ) : null}
      </section>

      <Suspense fallback={null}>
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
      </Suspense>
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
  onTagSearch,
}: {
  bookmark: Bookmark;
  categories: CategoryWithCount[];
  onDelete: () => void;
  onEdit: () => void;
  onMove: (categoryId: string | null) => void;
  onRecategorize: () => void;
  onSetReminder: () => void;
  onTagSearch: (tag: string) => void;
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
          loading="lazy"
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
          {bookmark.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bookmark.tags.map((tag) => (
                <button
                  aria-label={`${tag} 태그 검색`}
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                  key={tag}
                  onClick={() => onTagSearch(tag)}
                  type="button"
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
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
