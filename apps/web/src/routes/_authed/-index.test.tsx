import type { Bookmark } from "@my-bookmark/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listBookmarks, listCategories } from "../../lib/api-client";
import { BookmarkDialog } from "./-components/bookmark-dialogs";
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
  it("shows bookmark tags and searches when a tag is clicked", async () => {
    vi.mocked(listCategories).mockResolvedValue({ items: [] });
    vi.mocked(listBookmarks).mockResolvedValue({
      items: [bookmark],
      nextCursor: null,
    });

    renderHome();

    expect(await screen.findByText("React 19 핵심 변경 사항")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "React 태그 검색" }));

    expect(screen.getByPlaceholderText<HTMLInputElement>("검색").value).toBe(
      "React",
    );
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
});

describe("BookmarkDialog", () => {
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
