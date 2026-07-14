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
    fileSize: 5_773_378,
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
  metadata: {
    네이버지도: "https://map.naver.com/p/search/sample",
    지역: "강원도 강릉",
  },
  aiStatus: "done",
  aiModel: "openrouter/test",
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

describe("ImageDetailView", () => {
  it("shows the preview first and reveals the original explicitly", () => {
    const onEdit = vi.fn();
    const onRecategorize = vi.fn();
    const onDelete = vi.fn();
    const onMediaError = vi.fn();
    const onMediaSourceChange = vi.fn();

    render(
      <ImageDetailView
        bookmark={imageBookmark}
        categoryName="여행"
        onDelete={onDelete}
        onEdit={onEdit}
        onMediaError={onMediaError}
        onMediaSourceChange={onMediaSourceChange}
        onRecategorize={onRecategorize}
      />,
    );

    const image = screen.getByRole("img", { name: "푸른 바다 풍경" });
    expect(image).toHaveProperty("src", imageBookmark.image.thumbnailUrl);
    expect(image.className).toContain("h-[70dvh]");
    expect(image.className).toContain("max-h-[48rem]");
    expect(image.className).toContain("object-contain");
    expect(screen.getByText("등록일 2026. 7. 12.")).toBeTruthy();
    expect(screen.queryByText(/sample\.png/)).toBeNull();
    expect(screen.queryByText(/2×2/)).toBeNull();
    expect(screen.queryByText(/5\.5 MB/)).toBeNull();
    expect(screen.queryByText("분석 완료")).toBeNull();
    const mapLink = screen.getByRole("link", { name: "네이버지도" });
    expect(mapLink.getAttribute("target")).toBe("_blank");
    expect(mapLink.getAttribute("rel")).toBe("noreferrer");
    expect(mapLink.className).toContain("hover:bg-blue-700");
    expect(mapLink.className).not.toContain("hover:bg-[#03c75a]");
    expect(mapLink.className).toContain("hover:text-white");
    const locality = screen.getByText("지역: 강원도 강릉");
    expect(locality).toBeTruthy();
    expect(locality.parentElement?.className).not.toContain("truncate");
    expect(screen.queryByRole("link", { name: "원본 다운로드" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "원본 보기" }));
    expect(image).toHaveProperty("src", imageBookmark.image.originalUrl);
    const download = screen.getByRole("link", { name: "원본 다운로드" });
    expect(download.getAttribute("href")).toBe(imageBookmark.image.originalUrl);
    expect(download.getAttribute("download")).toBe("sample.png");

    fireEvent.click(
      screen.getByRole("button", { name: "미리보기로 돌아가기" }),
    );
    expect(image).toHaveProperty("src", imageBookmark.image.thumbnailUrl);
    expect(onMediaSourceChange).toHaveBeenCalledTimes(2);

    fireEvent.error(image);
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.click(screen.getByRole("button", { name: "AI 재분류" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(onMediaError).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onRecategorize).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("keeps showing the preview when the signed original is absent", () => {
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
        onMediaSourceChange={vi.fn()}
        onRecategorize={vi.fn()}
      />,
    );

    expect(screen.getByRole("img")).toHaveProperty(
      "src",
      imageBookmark.image.thumbnailUrl,
    );
    expect(screen.queryByRole("button", { name: "원본 보기" })).toBeNull();
    expect(screen.queryByRole("link", { name: "원본 다운로드" })).toBeNull();
  });

  it("shows the fallback after the one-shot preview refresh also fails", () => {
    render(
      <ImageDetailView
        bookmark={{
          ...imageBookmark,
          image: { ...imageBookmark.image, thumbnailUrl: null },
        }}
        categoryName={null}
        mediaBroken
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onMediaError={vi.fn()}
        onMediaSourceChange={vi.fn()}
        onRecategorize={vi.fn()}
      />,
    );

    expect(screen.getByText("미리보기를 불러오지 못했어요.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "원본 다운로드" })).toBeNull();
  });
});
