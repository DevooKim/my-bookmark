// @vitest-environment jsdom

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

vi.mock("../../../lib/api-client", () => ({
  createBookmark: vi.fn(),
  createCategory: vi.fn(),
  createReminder: vi.fn(),
  updateBookmark: vi.fn(),
  ApiClientError: class extends Error {},
}));

import { updateBookmark } from "../../../lib/api-client";
import { EditBookmarkDialog } from "./bookmark-dialogs";
import { TagInput } from "./tag-input";

afterEach(cleanup);

describe("TagInput", () => {
  it.each(["Enter", ","])("adds a trimmed tag with %s", (key) => {
    const onChange = vi.fn();
    render(<TagInput value={["개발"]} onChange={onChange} />);

    const input = screen.getByLabelText("태그");
    fireEvent.change(input, { target: { value: "  React  " } });
    fireEvent.keyDown(input, { key });

    expect(onChange).toHaveBeenCalledWith(["개발", "React"]);
  });

  it("adds a tag on blur and removes a chip accessibly", () => {
    const onChange = vi.fn();
    render(<TagInput value={["개발"]} onChange={onChange} />);

    const input = screen.getByLabelText("태그");
    fireEvent.change(input, { target: { value: "React" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(["개발", "React"]);

    fireEvent.click(screen.getByRole("button", { name: "개발 태그 삭제" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("ignores empty and duplicate tags", () => {
    const onChange = vi.fn();
    render(<TagInput value={["React"]} onChange={onChange} />);

    const input = screen.getByLabelText("태그");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: " React " } });
    fireEvent.keyDown(input, { key: "," });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects tags longer than twenty characters with an accessible message", () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} />);

    const input = screen.getByLabelText("태그");
    fireEvent.change(input, { target: { value: "가".repeat(21) } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "태그는 20자 이하로 입력해 주세요.",
    );
  });

  it("does not add more than five tags", () => {
    render(<TagInput value={["1", "2", "3", "4", "5"]} onChange={vi.fn()} />);

    expect(
      screen.getByText("태그는 최대 5개까지 추가할 수 있어요."),
    ).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("태그").disabled).toBe(true);
  });
});

describe("EditBookmarkDialog", () => {
  it("submits edited tags with the bookmark", async () => {
    vi.mocked(updateBookmark).mockResolvedValue({} as Bookmark);
    const bookmark: Bookmark = {
      id: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      url: "https://example.com/",
      title: "예제",
      description: null,
      siteName: null,
      faviconUrl: null,
      ogImageUrl: null,
      categoryId: null,
      tags: ["개발"],
      aiStatus: "done",
      aiModel: null,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditBookmarkDialog
          bookmark={bookmark}
          categories={[]}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("태그");
    fireEvent.change(input, { target: { value: "React" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(updateBookmark).toHaveBeenCalledWith(bookmark.id, {
        title: "예제",
        description: null,
        tags: ["개발", "React"],
        categoryId: null,
      }),
    );
  });
});
