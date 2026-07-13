import {
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

beforeEach(() => {
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
    .mockResolvedValueOnce({ id: "one" } as never)
    .mockRejectedValueOnce(new Error("upload failed"));
  const onUploaded = vi.fn();
  render(<ImageUpload onUploaded={onUploaded} />);
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
});

it("accepts an image pasted from the clipboard", async () => {
  vi.mocked(createImage).mockResolvedValue({ id: "pasted" } as never);
  render(<ImageUpload onUploaded={vi.fn()} />);
  const pasted = new File(["image"], "pasted.png", { type: "image/png" });

  fireEvent.paste(screen.getByTestId("image-drop-zone"), {
    clipboardData: { files: [pasted] },
  });

  await waitFor(() => expect(createImage).toHaveBeenCalledWith(pasted));
});
