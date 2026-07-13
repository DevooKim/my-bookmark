import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createImagesRouter } from "../routes/images";
import { ImageProcessingError } from "../services/image-processing";
import type { ImageStorageBucket } from "../services/image-storage";

const userId = "11111111-1111-4111-8111-111111111111";
const bookmarkId = "22222222-2222-4222-8222-222222222222";

const processedImage = {
  original: Buffer.from("original"),
  thumbnail: Buffer.from("thumbnail"),
  analysisImage: Buffer.from([1, 2, 3]),
  analysisMimeType: "image/jpeg" as const,
  extension: "png",
  mimeType: "image/png",
  width: 120,
  height: 80,
  filename: "sample.png",
};

const imageRow = {
  id: bookmarkId,
  user_id: userId,
  kind: "image" as const,
  url: null,
  title: null,
  description: null,
  site_name: null,
  favicon_url: null,
  og_image_url: null,
  category_id: null,
  tags: [],
  ai_status: "pending" as const,
  ai_model: null,
  image_original_path: `${userId}/${bookmarkId}/original.png`,
  image_thumbnail_path: `${userId}/${bookmarkId}/thumbnail.webp`,
  image_mime_type: "image/png",
  image_file_size: processedImage.original.byteLength,
  image_width: 120,
  image_height: 80,
  image_filename: "sample.png",
  created_at: "2026-07-13T10:00:00.000Z",
  updated_at: "2026-07-13T10:00:00.000Z",
};

function createDeps() {
  const storage: ImageStorageBucket = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.example/thumbnail" },
      error: null,
    }),
    download: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    storage,
    randomUUID: () => bookmarkId,
    processImage: vi.fn().mockResolvedValue(processedImage),
    insertImage: vi.fn().mockResolvedValue(imageRow),
    categorize: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestApp(deps = createDeps()) {
  const app = express();
  app.use(
    "/api",
    createImagesRouter(
      deps,
      requireAuth({
        bearer: async () => userId,
        apiKey: true,
        apiKeyVerifier: async () => userId,
      }),
    ),
  );
  app.use(errorMiddleware);
  return { app, deps };
}

describe("image routes", () => {
  it("accepts a bearer image and starts independent background analysis", async () => {
    const { app, deps } = createTestApp();
    const response = await request(app)
      .post("/api/images")
      .set("Authorization", "Bearer test")
      .attach("image", Buffer.from("file"), {
        filename: "sample.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(201);
    expect(response.body.bookmark).toMatchObject({
      id: bookmarkId,
      kind: "image",
      url: null,
      image: {
        thumbnailUrl: "https://signed.example/thumbnail",
        originalUrl: null,
        filename: "sample.png",
      },
      aiStatus: "pending",
    });
    await vi.waitFor(() =>
      expect(deps.categorize).toHaveBeenCalledWith({
        userId,
        bookmarkId,
        image: { mimeType: "image/jpeg", base64: "AQID" },
      }),
    );
  });

  it("accepts API Key auth and rejects a missing file", async () => {
    const { app } = createTestApp();
    const accepted = await request(app)
      .post("/api/images")
      .set("X-API-Key", "bm_test")
      .attach("image", Buffer.from("file"), "sample.png");
    expect(accepted.status).toBe(201);

    const missing = await request(app)
      .post("/api/images")
      .set("Authorization", "Bearer test");
    expect(missing.status).toBe(400);
    expect(missing.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "이미지 파일이 필요합니다" },
    });
  });

  it("returns 415 before Storage changes for unsupported input", async () => {
    const deps = createDeps();
    deps.processImage.mockRejectedValue(
      new ImageProcessingError(
        "지원하지 않는 이미지 형식입니다",
        "unsupported",
      ),
    );
    const { app } = createTestApp(deps);

    const response = await request(app)
      .post("/api/images")
      .set("Authorization", "Bearer test")
      .attach("image", Buffer.from("file"), "sample.svg");

    expect(response.status).toBe(415);
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });

  it("returns the common 413 error for files over 20MB", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/images")
      .set("Authorization", "Bearer test")
      .attach("image", Buffer.alloc(20 * 1024 * 1024 + 1), "large.jpg");

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "이미지는 20MB 이하여야 합니다",
      },
    });
  });

  it("cleans stored objects when the database insert fails", async () => {
    const deps = createDeps();
    deps.insertImage.mockRejectedValue(new Error("database failed"));
    const { app } = createTestApp(deps);

    const response = await request(app)
      .post("/api/images")
      .set("Authorization", "Bearer test")
      .attach("image", Buffer.from("file"), "sample.png");

    expect(response.status).toBe(500);
    expect(deps.storage.remove).toHaveBeenCalledWith([
      `${userId}/${bookmarkId}/original.png`,
      `${userId}/${bookmarkId}/thumbnail.webp`,
    ]);
  });
});
