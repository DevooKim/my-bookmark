import type { Bookmark } from "@my-bookmark/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createImage } from "../../../lib/api-client";
import { createHeicPreviewBlob } from "./heic-preview";
import { ImageUpload } from "./image-upload";

vi.mock("../../../lib/api-client", () => ({ createImage: vi.fn() }));
vi.mock("./heic-preview", async (importOriginal) => {
  const original = await importOriginal<typeof import("./heic-preview")>();
  return { ...original, createHeicPreviewBlob: vi.fn() };
});

const uploadedBookmark: Bookmark = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  kind: "image",
  url: null,
  image: {
    thumbnailUrl: "https://signed.example/thumbnail",
    originalUrl: null,
    mimeType: "image/png",
    fileSize: 3,
    width: 1,
    height: 1,
    filename: "image.png",
  },
  title: null,
  description: null,
  siteName: null,
  faviconUrl: null,
  ogImageUrl: null,
  categoryId: null,
  tags: [],
  metadata: {},
  aiStatus: "pending",
  aiModel: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((value: Blob | File) =>
      value instanceof File ? `blob:${value.name}` : "blob:heic-preview",
    ),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("uploads multiple images independently and keeps a failed item retryable", async () => {
  vi.mocked(createImage)
    .mockResolvedValueOnce(uploadedBookmark)
    .mockRejectedValueOnce(new Error("upload failed"));
  const onUploaded = vi.fn();
  const onAllSettled = vi.fn();
  const { unmount } = render(
    <ImageUpload onAllSettled={onAllSettled} onUploaded={onUploaded} />,
  );
  const files = [
    new File(["one"], "one.png", { type: "image/png" }),
    new File(["two"], "two.jpg", { type: "image/jpeg" }),
  ];

  fireEvent.change(screen.getByLabelText("이미지 선택"), {
    target: { files },
  });

  expect(createImage).not.toHaveBeenCalled();
  expect(screen.getAllByText("선택됨")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "이미지 저장" }));
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("완료")).toBeTruthy();
  expect(await screen.findByText("다시 시도")).toBeTruthy();
  expect(onUploaded).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(onAllSettled).toHaveBeenCalledWith({
      successCount: 1,
      failureCount: 1,
    }),
  );
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();

  vi.mocked(createImage).mockResolvedValueOnce(uploadedBookmark);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() =>
    expect(onAllSettled).toHaveBeenLastCalledWith({
      successCount: 2,
      failureCount: 0,
    }),
  );

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("derives a local preview for HEIC but uploads the original file", async () => {
  let resolvePreview: ((blob: Blob) => void) | undefined;
  vi.mocked(createHeicPreviewBlob).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
  );
  vi.mocked(createImage).mockResolvedValue(uploadedBookmark);
  const { unmount } = render(<ImageUpload onUploaded={vi.fn()} />);
  const heic = new File(["heic"], "iphone.heic", { type: "image/heic" });

  fireEvent.change(screen.getByLabelText("이미지 선택"), {
    target: { files: [heic] },
  });
  expect(screen.getByText("HEIC 미리보기 준비 중…")).toBeTruthy();
  expect(URL.createObjectURL).not.toHaveBeenCalled();

  await act(async () =>
    resolvePreview?.(new Blob(["jpeg"], { type: "image/jpeg" })),
  );
  await waitFor(() =>
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "blob:heic-preview",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "이미지 저장" }));
  await waitFor(() => expect(createImage).toHaveBeenCalledWith(heic));

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:heic-preview");
});

it("shows a stable HEIC placeholder when local preview decoding fails", async () => {
  vi.mocked(createHeicPreviewBlob).mockRejectedValue(
    new Error("decode failed"),
  );
  render(<ImageUpload onUploaded={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("이미지 선택"), {
    target: {
      files: [new File(["heic"], "broken.heic", { type: "image/heic" })],
    },
  });

  expect(await screen.findByText("HEIC")).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText("선택됨")).toBeTruthy();
});

it("accepts an image pasted from the clipboard", async () => {
  vi.mocked(createImage).mockResolvedValue(uploadedBookmark);
  render(<ImageUpload onUploaded={vi.fn()} />);
  const pasted = new File(["image"], "pasted.png", { type: "image/png" });

  fireEvent.paste(screen.getByTestId("image-drop-zone"), {
    clipboardData: { files: [pasted] },
  });

  expect(createImage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "이미지 저장" }));
  await waitFor(() => expect(createImage).toHaveBeenCalledWith(pasted));
});

it("limits concurrency to two across repeated selections", async () => {
  const resolvers: Array<(bookmark: Bookmark) => void> = [];
  vi.mocked(createImage).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  render(<ImageUpload onUploaded={vi.fn()} />);
  const input = screen.getByLabelText("이미지 선택");

  fireEvent.change(input, {
    target: {
      files: [
        new File(["1"], "1.png", { type: "image/png" }),
        new File(["2"], "2.png", { type: "image/png" }),
      ],
    },
  });
  fireEvent.change(input, {
    target: {
      files: [
        new File(["3"], "3.png", { type: "image/png" }),
        new File(["4"], "4.png", { type: "image/png" }),
      ],
    },
  });

  expect(createImage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "이미지 저장" }));
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(2));
  await act(async () => {
    resolvers[0]?.(uploadedBookmark);
    resolvers[1]?.(uploadedBookmark);
  });
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(4));
});

it("routes retries through the same two-upload scheduler", async () => {
  const resolvers: Array<(bookmark: Bookmark) => void> = [];
  vi.mocked(createImage)
    .mockRejectedValueOnce(new Error("upload failed"))
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
  render(<ImageUpload onUploaded={vi.fn()} />);

  fireEvent.change(screen.getByLabelText("이미지 선택"), {
    target: {
      files: [
        new File(["1"], "1.png", { type: "image/png" }),
        new File(["2"], "2.png", { type: "image/png" }),
        new File(["3"], "3.png", { type: "image/png" }),
      ],
    },
  });

  expect(createImage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "이미지 저장" }));
  const retry = await screen.findByRole("button", { name: "다시 시도" });
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(3));
  fireEvent.click(retry);
  await act(async () => Promise.resolve());
  expect(createImage).toHaveBeenCalledTimes(3);

  await act(async () => resolvers[0]?.(uploadedBookmark));
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(4));
});
