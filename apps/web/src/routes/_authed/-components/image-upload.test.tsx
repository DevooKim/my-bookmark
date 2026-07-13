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
import { ImageUpload } from "./image-upload";

vi.mock("../../../lib/api-client", () => ({ createImage: vi.fn() }));

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
  aiStatus: "pending",
  aiModel: null,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
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
  const { unmount } = render(<ImageUpload onUploaded={onUploaded} />);
  const files = [
    new File(["one"], "one.png", { type: "image/png" }),
    new File(["two"], "two.jpg", { type: "image/jpeg" }),
  ];

  fireEvent.change(screen.getByLabelText("이미지 선택"), {
    target: { files },
  });

  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("완료")).toBeTruthy();
  expect(await screen.findByText("다시 시도")).toBeTruthy();
  expect(onUploaded).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();

  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it("accepts an image pasted from the clipboard", async () => {
  vi.mocked(createImage).mockResolvedValue(uploadedBookmark);
  render(<ImageUpload onUploaded={vi.fn()} />);
  const pasted = new File(["image"], "pasted.png", { type: "image/png" });

  fireEvent.paste(screen.getByTestId("image-drop-zone"), {
    clipboardData: { files: [pasted] },
  });

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

  const retry = await screen.findByRole("button", { name: "다시 시도" });
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(3));
  fireEvent.click(retry);
  await act(async () => Promise.resolve());
  expect(createImage).toHaveBeenCalledTimes(3);

  await act(async () => resolvers[0]?.(uploadedBookmark));
  await waitFor(() => expect(createImage).toHaveBeenCalledTimes(4));
});
