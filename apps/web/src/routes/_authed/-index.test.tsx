import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookmarkDialog } from "./-components/bookmark-dialogs";

vi.mock("../../../lib/api-client", () => ({
  ApiClientError: class ApiClientError extends Error {
    status = 500;
  },
  createBookmark: vi.fn(),
  createCategory: vi.fn(),
  deleteBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  listCategories: vi.fn(),
  updateBookmark: vi.fn(),
}));

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
