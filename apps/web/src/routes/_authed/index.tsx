import type { Bookmark, CategoryWithCount } from "@my-bookmark/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  BookmarkPlus,
  Clock,
  Edit,
  MoreVertical,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  deleteBookmark,
  listBookmarks,
  listCategories,
  recategorizeBookmark,
} from "../../lib/api-client";
import {
  consumeBookmarkDialogRequest,
  OPEN_BOOKMARK_DIALOG_EVENT,
} from "../../lib/bookmark-dialog";

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

  useEffect(() => {
    const openDialog = () => {
      consumeBookmarkDialogRequest();
      setIsAddOpen(true);
    };
    window.addEventListener(OPEN_BOOKMARK_DIALOG_EVENT, openDialog);
    if (consumeBookmarkDialogRequest()) {
      setIsAddOpen(true);
    }
    return () =>
      window.removeEventListener(OPEN_BOOKMARK_DIALOG_EVENT, openDialog);
  }, []);

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
    <main className="page-stack">
      <section className="space-y-3">
        <label className="search-field">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            aria-label="북마크 검색"
            className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="제목, 설명, 태그 검색"
            type="search"
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

      <button
        aria-label="북마크 추가"
        className="fixed bottom-6 right-6 z-30 hidden h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 sm:inline-flex dark:bg-blue-500 dark:hover:bg-blue-400"
        onClick={() => setIsAddOpen(true)}
        type="button"
      >
        <Plus className="h-6 w-6" />
      </button>

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
          <div className="empty-state">
            <BookmarkPlus className="mx-auto h-10 w-10 text-blue-500" />
            <p className="mt-4 text-lg font-semibold">첫 링크를 담아보세요</p>
            <p className="mt-1 text-sm text-zinc-500">
              AI가 제목과 분류를 정리해 드립니다.
            </p>
            <button
              aria-label="북마크 추가"
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
            categories={categories}
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
  onRecategorize,
  onSetReminder,
  onTagSearch,
}: {
  bookmark: Bookmark;
  categories: CategoryWithCount[];
  onDelete: () => void;
  onEdit: () => void;
  onRecategorize: () => void;
  onSetReminder: () => void;
  onTagSearch: (tag: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const category = categories.find((item) => item.id === bookmark.categoryId);
  const title = bookmark.title ?? new URL(bookmark.url).hostname;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    menuTriggerRef.current?.focus();
    action();
  };

  return (
    <article className="bookmark-card">
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
            className="text-[1.02rem] font-semibold leading-snug tracking-[-0.01em] hover:text-blue-600"
            href={bookmark.url}
            rel="noreferrer"
            target="_blank"
          >
            {title}
          </a>
          {bookmark.description ? (
            <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-300">
              {bookmark.description}
            </p>
          ) : null}
          <p className="mt-2 truncate text-sm text-zinc-500">
            {new URL(bookmark.url).hostname.replace(/^www\./, "")} ·{" "}
            {category?.name ?? "미분류"}
          </p>
          {bookmark.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1 sm:gap-1.5">
              {bookmark.tags.map((tag) => (
                <Fragment key={tag}>
                  <span
                    className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[0.6875rem] leading-4 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 sm:hidden"
                    data-testid={`mobile-tag-${tag}`}
                  >
                    {tag}
                  </span>
                  <button
                    aria-label={`${tag} 태그 검색`}
                    className="hidden min-h-7 items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[0.6875rem] leading-4 text-zinc-600 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100 sm:inline-flex"
                    onClick={() => onTagSearch(tag)}
                    type="button"
                  >
                    {tag}
                  </button>
                </Fragment>
              ))}
            </div>
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
        <div className="relative" ref={menuRef}>
          <button
            aria-controls={`bookmark-menu-${bookmark.id}`}
            aria-expanded={menuOpen}
            aria-label="북마크 메뉴"
            className="icon-button"
            onClick={() => setMenuOpen((open) => !open)}
            ref={menuTriggerRef}
            type="button"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div
              className="popover-surface"
              id={`bookmark-menu-${bookmark.id}`}
            >
              <button
                className="menu-item"
                onClick={() => runMenuAction(onEdit)}
                type="button"
              >
                <Edit className="h-4 w-4" /> 편집
              </button>
              {bookmark.aiStatus !== "pending" ? (
                <button
                  className="menu-item"
                  onClick={() =>
                    runMenuAction(() => {
                      if (
                        window.confirm(
                          "AI가 제목, 요약, 태그, 카테고리를 다시 생성합니다. 계속할까요?",
                        )
                      ) {
                        onRecategorize();
                      }
                    })
                  }
                  type="button"
                >
                  <Sparkles className="h-4 w-4" /> AI 재분류
                </button>
              ) : null}
              <button
                className="menu-item"
                onClick={() => runMenuAction(onSetReminder)}
                type="button"
              >
                <Clock className="h-4 w-4" /> 리마인더
              </button>
              <button
                className="menu-item text-red-600"
                onClick={() => runMenuAction(onDelete)}
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
