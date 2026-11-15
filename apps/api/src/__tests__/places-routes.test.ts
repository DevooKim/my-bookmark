import { placeGroupsResponseSchema } from "@my-bookmark/shared";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../middleware/auth";
import { errorMiddleware } from "../middleware/error";
import {
  createPlacesRouter,
  type PlaceGroupRow,
  type PlacesDeps,
} from "../routes/places";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "99999999-9999-4999-8999-999999999999";
const linkId = "22222222-2222-4222-8222-222222222222";
const imageId = "33333333-3333-4333-8333-333333333333";
const otherUserBookmarkId = "44444444-4444-4444-8444-444444444444";

function row(
  overrides: Partial<Omit<PlaceGroupRow, "bookmarks">> & {
    bookmarks?: Partial<PlaceGroupRow["bookmarks"]>;
  },
): PlaceGroupRow {
  const { bookmarks, ...place } = overrides;
  const bookmarkId = place.bookmark_id ?? linkId;
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    bookmark_id: bookmarkId,
    position: 0,
    name: "장소",
    locality: "서촌",
    country_code: "KR",
    geocode_status: "resolved",
    lat: 37.58,
    lng: 126.97,
    address: "서울 종로구",
    road_address: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...place,
    bookmarks: {
      id: bookmarkId,
      kind: "link",
      url: "https://example.com/post",
      title: "서촌 카페 6곳 추천",
      image_filename: null,
      image_thumbnail_path: null,
      created_at: "2026-11-01T00:00:00.000Z",
      ...bookmarks,
    },
  };
}

function createApp(allRows: PlaceGroupRow[]) {
  const listResolvedPlaces = vi.fn(async (requestedUserId: string) =>
    allRows.filter((item) => item.user_id === requestedUserId),
  );
  const signThumbnail = vi.fn(async (path: string) => `https://signed/${path}`);
  const deps: PlacesDeps = { listResolvedPlaces, signThumbnail };
  const app = express();
  app.use(
    "/api",
    createPlacesRouter(deps, requireAuth({ bearer: async () => userId })),
  );
  app.use(errorMiddleware);
  return { app, listResolvedPlaces, signThumbnail };
}

describe("GET /api/places", () => {
  it("groups places by bookmark, newest bookmark first, places in position order", async () => {
    const { app, signThumbnail } = createApp([
      row({ position: 1, name: "둘째" }),
      row({ position: 0, name: "첫째" }),
      row({
        bookmark_id: imageId,
        name: "교토 말고 대전",
        bookmarks: {
          id: imageId,
          kind: "image",
          url: null,
          title: "대전 맛집 이미지",
          image_thumbnail_path: `${userId}/${imageId}/thumbnail.webp`,
          created_at: "2026-11-10T00:00:00.000Z",
        },
      }),
    ]);

    const response = await request(app)
      .get("/api/places")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    const body = placeGroupsResponseSchema.parse(response.body);
    expect(body.items.map((group) => group.bookmark.id)).toEqual([
      imageId,
      linkId,
    ]);
    expect(body.items[0]?.bookmark).toEqual({
      id: imageId,
      kind: "image",
      title: "대전 맛집 이미지",
      url: null,
      thumbnailUrl: `https://signed/${userId}/${imageId}/thumbnail.webp`,
    });
    expect(body.items[1]?.bookmark).toEqual({
      id: linkId,
      kind: "link",
      title: "서촌 카페 6곳 추천",
      url: "https://example.com/post",
      thumbnailUrl: null,
    });
    expect(body.items[1]?.places.map((place) => place.name)).toEqual([
      "첫째",
      "둘째",
    ]);
    expect(body.items[1]?.places[0]).toMatchObject({
      lat: 37.58,
      lng: 126.97,
      mapProvider: "naver",
    });
    expect(signThumbnail).toHaveBeenCalledTimes(1);
  });

  it("only reads the authenticated user's places", async () => {
    const { app, listResolvedPlaces } = createApp([
      row({ name: "내 장소" }),
      row({
        user_id: otherUserId,
        bookmark_id: otherUserBookmarkId,
        name: "남의 장소",
        bookmarks: { id: otherUserBookmarkId, title: "남의 게시글" },
      }),
    ]);

    const response = await request(app)
      .get("/api/places")
      .set("Authorization", "Bearer test-token");

    expect(listResolvedPlaces).toHaveBeenCalledWith(userId);
    expect(JSON.stringify(response.body)).not.toContain("남의");
    expect(response.body.items).toHaveLength(1);
  });

  it("omits places without coordinates and bookmarks left without any", async () => {
    const { app } = createApp([
      row({ name: "좌표 없음", lat: null, lng: null }),
      row({
        bookmark_id: imageId,
        name: "좌표 있음",
        bookmarks: {
          id: imageId,
          kind: "image",
          url: null,
          title: "이미지",
          created_at: "2026-11-02T00:00:00.000Z",
        },
      }),
    ]);

    const response = await request(app)
      .get("/api/places")
      .set("Authorization", "Bearer test-token");

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].bookmark.id).toBe(imageId);
    expect(response.body.items[0].bookmark.thumbnailUrl).toBeNull();
  });

  it("falls back to the hostname or filename when the title is missing", async () => {
    const { app } = createApp([
      row({ bookmarks: { title: null } }),
      row({
        bookmark_id: imageId,
        bookmarks: {
          id: imageId,
          kind: "image",
          url: null,
          title: null,
          image_filename: "IMG_0001.heic",
          created_at: "2026-11-02T00:00:00.000Z",
        },
      }),
    ]);

    const response = await request(app)
      .get("/api/places")
      .set("Authorization", "Bearer test-token");

    expect(
      response.body.items.map(
        (group: { bookmark: { title: string } }) => group.bookmark.title,
      ),
    ).toEqual(["IMG_0001.heic", "example.com"]);
  });

  it("returns an empty list when nothing is resolved", async () => {
    const { app } = createApp([]);
    const response = await request(app)
      .get("/api/places")
      .set("Authorization", "Bearer test-token");
    expect(response.body).toEqual({ items: [] });
  });

  it("requires a bearer token and rejects API keys", async () => {
    const { app } = createApp([row({})]);
    expect((await request(app).get("/api/places")).status).toBe(401);
    expect(
      (await request(app).get("/api/places").set("X-API-Key", "bm_test"))
        .status,
    ).toBe(401);
  });
});
