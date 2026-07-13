import { describe, expect, it, vi } from "vitest";
import {
  type ImageStorageBucket,
  loadImageForAnalysis,
  removeImage,
  signImage,
  storeImage,
} from "../services/image-storage";

const image = {
  original: Buffer.from("original"),
  thumbnail: Buffer.from("thumbnail"),
  analysisImage: Buffer.from("analysis"),
  analysisMimeType: "image/jpeg" as const,
  extension: "png",
  mimeType: "image/png",
  width: 120,
  height: 80,
  filename: "sample.png",
};

function fakeBucket(): ImageStorageBucket {
  return {
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.example/image" },
      error: null,
    }),
    download: vi.fn().mockResolvedValue({
      data: new Blob([Buffer.from("downloaded")]),
      error: null,
    }),
  };
}

describe("image storage", () => {
  it("stores deterministic private original and thumbnail paths", async () => {
    const storage = fakeBucket();
    const paths = await storeImage({
      storage,
      userId: "user-1",
      bookmarkId: "bookmark-1",
      image,
    });

    expect(paths).toEqual({
      originalPath: "user-1/bookmark-1/original.png",
      thumbnailPath: "user-1/bookmark-1/thumbnail.webp",
    });
    expect(storage.upload).toHaveBeenNthCalledWith(
      1,
      paths.originalPath,
      image.original,
      { contentType: "image/png", upsert: false },
    );
    expect(storage.upload).toHaveBeenNthCalledWith(
      2,
      paths.thumbnailPath,
      image.thumbnail,
      { contentType: "image/webp", upsert: false },
    );
  });

  it("removes the original when thumbnail upload fails", async () => {
    const storage = fakeBucket();
    vi.mocked(storage.upload)
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "thumbnail failed" } });

    await expect(
      storeImage({
        storage,
        userId: "user-1",
        bookmarkId: "bookmark-1",
        image,
      }),
    ).rejects.toThrow("thumbnail failed");
    expect(storage.remove).toHaveBeenCalledWith([
      "user-1/bookmark-1/original.png",
    ]);
  });

  it("removes both objects and signs a requested object", async () => {
    const storage = fakeBucket();
    const paths = {
      originalPath: "user-1/bookmark-1/original.png",
      thumbnailPath: "user-1/bookmark-1/thumbnail.webp",
    };

    await removeImage(storage, paths);
    await expect(signImage(storage, paths.thumbnailPath)).resolves.toBe(
      "https://signed.example/image",
    );
    expect(storage.remove).toHaveBeenCalledWith([
      paths.originalPath,
      paths.thumbnailPath,
    ]);
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      paths.thumbnailPath,
      600,
    );
  });

  it("downloads a private original and returns normalized base64", async () => {
    const storage = fakeBucket();
    const processor = vi.fn().mockResolvedValue(image);

    await expect(
      loadImageForAnalysis(
        storage,
        "user-1/bookmark-1/original.heic",
        processor,
      ),
    ).resolves.toEqual({
      mimeType: "image/jpeg",
      base64: image.analysisImage.toString("base64"),
    });
    expect(processor).toHaveBeenCalledWith(
      Buffer.from("downloaded"),
      "original.heic",
    );
  });
});
