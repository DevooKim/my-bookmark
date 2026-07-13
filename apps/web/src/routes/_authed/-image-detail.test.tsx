import type { Bookmark } from "@my-bookmark/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageDetailView } from "./images.$id";

afterEach(cleanup);

const imageBookmark: Extract<Bookmark, { kind: "image" }> = {
  id: "00000000-0000-4000-8000-000000000004",
  userId: "00000000-0000-4000-8000-000000000002",
  kind: "image",
  url: null,
  image: {
    thumbnailUrl: "https://signed.example/thumbnail",
    originalUrl: "https://signed.example/original",
    mimeType: "image/png",
    fileSize: 4,
    width: 2,
    height: 2,
    filename: "sample.png",
  },
  title: "푸른 바다 풍경",
  description: "잔잔한 파도와 맑은 하늘",
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
  categoryId: null,
  tags: ["바다", "여행"],
  aiStatus: "done",
  aiModel: "openrouter/test",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

describe("ImageDetailView", () => {
  it("renders the private original and exposes image actions", () => {
    const onEdit = vi.fn();
    const onRecategorize = vi.fn();
    const onDelete = vi.fn();
    const onMediaError = vi.fn();

    render(
      <ImageDetailView
        bookmark={imageBookmark}
        categoryName="여행"
        onDelete={onDelete}
        onEdit={onEdit}
        onMediaError={onMediaError}
        onRecategorize={onRecategorize}
      />,
    );

    const image = screen.getByRole("img", { name: "푸른 바다 풍경" });
    expect(image).toHaveProperty("src", imageBookmark.image.originalUrl);
    const download = screen.getByRole("link", { name: "원본 다운로드" });
    expect(download.getAttribute("href")).toBe(imageBookmark.image.originalUrl);
    expect(download.getAttribute("download")).toBe("sample.png");

    fireEvent.error(image);
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 재분류" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(onMediaError).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onRecategorize).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("shows a recoverable state when the signed original is absent", () => {
    render(
      <ImageDetailView
        bookmark={{
          ...imageBookmark,
          image: { ...imageBookmark.image, originalUrl: null },
        }}
        categoryName={null}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onMediaError={vi.fn()}
        onRecategorize={vi.fn()}
      />,
    );

    expect(screen.getByText("원본 이미지를 불러오지 못했어요.")).toBeTruthy();
  });
});
