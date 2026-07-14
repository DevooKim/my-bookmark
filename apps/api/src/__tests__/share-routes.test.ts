import type { Bookmark } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import { createShareRouter } from "../routes/share";

const userId = "11111111-1111-4111-8111-111111111111";

const linkBookmark: Bookmark = {
  id: "22222222-2222-4222-8222-222222222222",
  userId,
  kind: "link",
  url: "https://example.com/post",
  image: null,
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
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

const imageBookmark: Bookmark = {
  ...linkBookmark,
  id: "33333333-3333-4333-8333-333333333333",
  kind: "image",
  url: null,
  image: {
    thumbnailUrl: "https://signed.example/thumbnail",
    originalUrl: null,
    mimeType: "image/heic",
    fileSize: 5,
    width: 10,
    height: 20,
    filename: "photo.heic",
  },
};

function createTestApp() {
  const createLink = vi.fn().mockResolvedValue(linkBookmark);
  const createImage = vi.fn().mockResolvedValue(imageBookmark);
  const app = express();
  app.use(
    "/api",
    createShareRouter(
      { createLink, createImage },
      requireAuth({
        bearer: async () => userId,
        apiKey: true,
        apiKeyVerifier: async () => userId,
      }),
    ),
  );
  app.use(errorMiddleware);
  return { app, createLink, createImage };
}

describe("unified share route", () => {
  it("creates an AI link from a text item", async () => {
    const { app, createLink, createImage } = createTestApp();
    const response = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .field("item", "https://example.com/post");

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ bookmark: linkBookmark });
    expect(createLink).toHaveBeenCalledWith({
      userId,
      request: { url: "https://example.com/post", mode: "ai" },
    });
    expect(createImage).not.toHaveBeenCalled();
  });

  it("creates an image from an API Key file item", async () => {
    const { app, createLink, createImage } = createTestApp();
    const response = await request(app)
      .post("/api/share")
      .set("X-API-Key", "bm_test")
      .attach("item", Buffer.from("image"), {
        filename: "photo.heic",
        contentType: "image/heic",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ bookmark: imageBookmark });
    expect(createImage).toHaveBeenCalledWith({
      userId,
      bytes: Buffer.from("image"),
      filename: "photo.heic",
    });
    expect(createLink).not.toHaveBeenCalled();
  });

  it("rejects missing and ambiguous items", async () => {
    const { app, createLink, createImage } = createTestApp();
    const missing = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test");
    const ambiguous = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .field("item", "https://example.com/post")
      .attach("item", Buffer.from("image"), "photo.jpg");

    for (const response of [missing, ambiguous]) {
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expect(createLink).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs", async () => {
    const { app, createLink } = createTestApp();
    const response = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .field("item", "not a url");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(createLink).not.toHaveBeenCalled();
  });

  it("rejects unexpected fields and multiple files", async () => {
    const { app } = createTestApp();
    const unexpected = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .attach("wrong", Buffer.from("image"), "photo.jpg");
    const multiple = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .attach("item", Buffer.from("one"), "one.jpg")
      .attach("item", Buffer.from("two"), "two.jpg");

    for (const response of [unexpected, multiple]) {
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual({
        code: "VALIDATION_ERROR",
        message: "이미지 업로드 형식이 올바르지 않습니다",
      });
    }
  });

  it("rejects additional multipart text fields", async () => {
    const { app, createLink } = createTestApp();
    const extraField = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .field("item", "https://example.com/post")
      .field("extra", "ignored before validation");
    const repeatedItem = await request(app)
      .post("/api/share")
      .set("Authorization", "Bearer test")
      .field("item", "https://example.com/one")
      .field("item", "https://example.com/two");

    for (const response of [extraField, repeatedItem]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(createLink).not.toHaveBeenCalled();
  });
});
