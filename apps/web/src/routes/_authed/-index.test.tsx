import type { Bookmark, CategoryWithCount } from "@my-bookmark/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listBookmarks,
  listCategories,
  updateBookmark,
} from "../../lib/api-client";
import { requestBookmarkDialog } from "../../lib/bookmark-dialog";
import {
  BookmarkDialog,
  EditBookmarkDialog,
} from "./-components/bookmark-dialogs";
import { HomePage } from "./index";

vi.mock("../../lib/api-client", () => ({
  ApiClientError: class ApiClientError extends Error {
    status = 500;
  },
  createBookmark: vi.fn(),
  createCategory: vi.fn(),
  deleteBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  listCategories: vi.fn(),
  recategorizeBookmark: vi.fn(),
  updateBookmark: vi.fn(),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
});

vi.mock("@tanstack/react-virtual", () => ({
  useWindowVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 160,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 160,
      })),
    measureElement: vi.fn(),
    options: { scrollMargin: 0 },
  }),
}));

const bookmark: Bookmark = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  url: "https://example.com/react",
  title: "React 19 핵심 변경 사항",
  description: null,
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
  categoryId: null,
  tags: ["React", "프론트엔드", "웹 개발"],
  aiStatus: "done",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

const category: CategoryWithCount = {
  id: "00000000-0000-4000-8000-000000000003",
  userId: bookmark.userId,
  name: "개발",
  sortOrder: 0,
  createdAt: "2026-07-12T00:00:00.000Z",
  bookmarkCount: 1,
};

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
  it("renders search controls without a library hero", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({ items: [], nextCursor: null });

    renderHome();

    const search = await screen.findByRole("searchbox", {
      name: "북마크 검색",
    });
    expect(screen.queryByRole("heading", { name: "라이브러리" })).toBeNull();
    expect(search.closest("section")?.className).not.toContain(
      "library-toolbar",
    );
    expect(screen.getByRole("button", { name: "전체" })).toBeTruthy();

    const addButton = screen.getByRole("button", { name: "북마크 추가" });
    expect(addButton.className).toContain("fixed");
    expect(addButton.className).toContain("sm:inline-flex");
    expect(addButton.className).toContain("rounded-full");
  });

  it("shows bookmark tags and searches when a tag is clicked", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [bookmark],
      nextCursor: null,
    });

    renderHome();

    expect(await screen.findByText("React 19 핵심 변경 사항")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "React 태그 검색" }));

    expect(
      screen.getByRole<HTMLInputElement>("searchbox", {
        name: "북마크 검색",
      }).value,
    ).toBe("React");
  });

  it("renders compact read-only tag badges on mobile", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [bookmark],
      nextCursor: null,
    });

    renderHome();

    const mobileTag = await screen.findByTestId("mobile-tag-React");
    expect(mobileTag.tagName).toBe("SPAN");
    expect(mobileTag.className).toContain("text-[0.6875rem]");
    expect(mobileTag.className).toContain("text-zinc-600");
    expect(mobileTag.className).toContain("sm:hidden");

    const tagButton = screen.getByRole("button", {
      name: "React 태그 검색",
    });
    expect(tagButton.className).toContain("hidden");
    expect(tagButton.className).toContain("sm:inline-flex");
    expect(tagButton.className).toContain("min-h-7");
    expect(tagButton.className).toContain("text-[0.6875rem]");
    expect(tagButton.className).not.toContain("min-h-11");
  });

  it("opens the bookmark dialog from a mobile navigation request", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({ items: [], nextCursor: null });

    requestBookmarkDialog();
    renderHome();

    expect(
      await screen.findByRole("dialog", { name: "북마크 추가" }),
    ).toBeTruthy();
  });

  it("dismisses the bookmark menu outside, with Escape, and after an action", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [category] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [bookmark],
      nextCursor: null,
    });

    renderHome();

    const menuButton = await screen.findByRole("button", {
      name: "북마크 메뉴",
    });
    expect(menuButton.getAttribute("aria-haspopup")).toBeNull();
    expect(menuButton.getAttribute("aria-controls")).toBeTruthy();
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "편집" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "편집" })).toBeNull();

    fireEvent.click(menuButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "편집" })).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    expect(
      await screen.findByRole("dialog", { name: "북마크 편집" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "편집" })).toBeNull();
    expect(screen.queryByRole("button", { name: "미분류로 변경" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(document.activeElement).toBe(menuButton);
  });

  it("does not render tag search buttons when tags are empty", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [{ ...bookmark, tags: [] }],
      nextCursor: null,
    });

    renderHome();

    await waitFor(() =>
      expect(screen.getByText("React 19 핵심 변경 사항")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: /태그 검색$/ })).toBeNull();
  });

  it("orders bookmark content as title, summary, metadata, then tags", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [
        { ...bookmark, description: "핵심 변경 사항을 한국어로 요약했어요." },
      ],
      nextCursor: null,
    });

    renderHome();

    const title = await screen.findByText("React 19 핵심 변경 사항");
    const summary = screen.getByText("핵심 변경 사항을 한국어로 요약했어요.");
    const metadata = screen.getByText(/example.com/);
    const tag = screen.getByRole("button", { name: "React 태그 검색" });

    expect(
      title.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      summary.compareDocumentPosition(metadata) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      metadata.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("renders the AI summary clamped to three lines", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [
        {
          ...bookmark,
          description: "요약 첫 문장. 요약 둘째 문장. 요약 셋째 문장.",
        },
      ],
      nextCursor: null,
    });

    renderHome();

    const summary = await screen.findByText(
      "요약 첫 문장. 요약 둘째 문장. 요약 셋째 문장.",
    );
    expect(summary.className).toContain("line-clamp-3");
  });
});

describe("BookmarkDialog", () => {
  it("renders the add dialog with an opaque surface", () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BookmarkDialog categories={[]} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("dialog-surface-opaque");
    expect(dialog.parentElement?.className).toContain("dialog-scrim-blur");
  });

  it("opens as a labelled modal dialog", () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BookmarkDialog categories={[]} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(
      screen
        .getByRole("dialog", { name: "북마크 추가" })
        .getAttribute("aria-modal"),
    ).toBe("true");
    const urlInput = screen.getByRole("textbox", { name: "URL" });
    expect(urlInput).toBeTruthy();
    expect(document.activeElement).toBe(urlInput);
  });

  it("closes the modal with Escape", () => {
    const queryClient = new QueryClient();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <BookmarkDialog categories={[]} onClose={onClose} />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes only when the modal backdrop is clicked", () => {
    const queryClient = new QueryClient();
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <BookmarkDialog categories={[]} onClose={onClose} />
      </QueryClientProvider>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    if (backdrop) {
      fireEvent.pointerDown(backdrop);
    }
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers inline category creation when manual mode is selected", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BookmarkDialog categories={[]} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    screen.getByRole("button", { name: "직접 선택" }).click();

    expect(
      await screen.findByRole("button", { name: /새 카테고리/ }),
    ).not.toBeNull();
  });
});

describe("EditBookmarkDialog", () => {
  it("updates the bookmark category from the edit form", async () => {
    const queryClient = new QueryClient();
    vi.mocked(updateBookmark).mockResolvedValue({
      ...bookmark,
      categoryId: category.id,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditBookmarkDialog
          bookmark={bookmark}
          categories={[category]}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("dialog").className).toContain(
      "dialog-surface-opaque",
    );

    fireEvent.change(screen.getByLabelText("카테고리"), {
      target: { value: category.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(updateBookmark).toHaveBeenCalledWith(bookmark.id, {
        title: bookmark.title,
        description: null,
        tags: bookmark.tags,
        categoryId: category.id,
      }),
    );
  });
});
