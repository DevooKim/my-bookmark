import { describe, expect, it, vi } from "vitest";
import type { BookmarkDbRow } from "../lib/db-mappers";
import { removeBookmarkMedia, signBookmarkMedia } from "../routes/bookmarks";
import type { ImageStorageBucket } from "../services/image-storage";

const imageRow: BookmarkDbRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  kind: "image",
  url: null,
  title: null,
  description: null,
  site_name: null,
  favicon_url: null,
  og_image_url: null,
  category_id: null,
  tags: [],
  ai_status: "pending",
  ai_model: null,
  image_original_path: "user/item/original.png",
  image_thumbnail_path: "user/item/thumbnail.webp",
  image_mime_type: "image/png",
  image_file_size: 10,
  image_width: 20,
  image_height: 10,
  image_filename: "photo.png",
  created_at: "2026-07-13T10:00:00.000Z",
  updated_at: "2026-07-13T10:00:00.000Z",
};

function fakeStorage(): ImageStorageBucket {
  return {
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    download: vi.fn().mockResolvedValue({ data: null, error: null }),
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://signed.example/${path}` },
      error: null,
    })),
  };
}

describe("bookmark image media", () => {
  it("signs only thumbnails for lists and includes originals for detail", async () => {
    const storage = fakeStorage();
    await expect(signBookmarkMedia(imageRow, storage, false)).resolves.toEqual({
      thumbnailUrl: "https://signed.example/user/item/thumbnail.webp",
      originalUrl: null,
    });
    await expect(signBookmarkMedia(imageRow, storage, true)).resolves.toEqual({
      thumbnailUrl: "https://signed.example/user/item/thumbnail.webp",
      originalUrl: "https://signed.example/user/item/original.png",
    });
  });

  it("removes both objects for images and does nothing for links", async () => {
    const storage = fakeStorage();
    await removeBookmarkMedia(imageRow, storage);
    expect(storage.remove).toHaveBeenCalledWith([
      imageRow.image_original_path,
      imageRow.image_thumbnail_path,
    ]);

    vi.mocked(storage.remove).mockClear();
    await removeBookmarkMedia(
      {
        ...imageRow,
        kind: "link",
        url: "https://example.com",
        image_original_path: null,
        image_thumbnail_path: null,
        image_mime_type: null,
        image_file_size: null,
        image_width: null,
        image_height: null,
        image_filename: null,
      },
      storage,
    );
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
