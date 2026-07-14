import { API_ERROR_CODES, type Bookmark } from "@my-bookmark/shared";
import { type BookmarkDbRow, mapBookmark } from "../lib/db-mappers";
import { HttpError } from "../middleware/error";
import { ImageProcessingError, type ProcessedImage } from "./image-processing";
import {
  type ImageStorageBucket,
  removeImage,
  signImage,
  storeImage,
} from "./image-storage";

export interface ImageInsert {
  id: string;
  user_id: string;
  kind: "image";
  url: null;
  image_original_path: string;
  image_thumbnail_path: string;
  image_mime_type: string;
  image_file_size: number;
  image_width: number;
  image_height: number;
  image_filename: string;
  ai_status: "pending";
}

export interface ImageBookmarkCreationDeps {
  storage: ImageStorageBucket;
  randomUUID: () => string;
  processImage: (bytes: Buffer, filename: string) => Promise<ProcessedImage>;
  insertImage: (row: ImageInsert) => Promise<BookmarkDbRow>;
  categorize: (input: {
    userId: string;
    bookmarkId: string;
    image: { mimeType: "image/jpeg"; base64: string };
  }) => Promise<void>;
}

export async function createImageBookmark(
  input: { userId: string; bytes: Buffer; filename: string },
  deps: ImageBookmarkCreationDeps,
): Promise<Bookmark> {
  let image: ProcessedImage;
  try {
    image = await deps.processImage(input.bytes, input.filename);
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      const status =
        error.reason === "too_large"
          ? 413
          : error.reason === "unsupported"
            ? 415
            : 400;
      throw new HttpError(
        status,
        API_ERROR_CODES.VALIDATION_ERROR,
        error.message,
      );
    }
    throw error;
  }

  const bookmarkId = deps.randomUUID();
  const paths = await storeImage({
    storage: deps.storage,
    userId: input.userId,
    bookmarkId,
    image,
  });
  let row: BookmarkDbRow;
  try {
    row = await deps.insertImage({
      id: bookmarkId,
      user_id: input.userId,
      kind: "image",
      url: null,
      image_original_path: paths.originalPath,
      image_thumbnail_path: paths.thumbnailPath,
      image_mime_type: image.mimeType,
      image_file_size: image.original.byteLength,
      image_width: image.width,
      image_height: image.height,
      image_filename: image.filename,
      ai_status: "pending",
    });
  } catch (error) {
    await removeImage(deps.storage, paths).catch(() =>
      console.warn("image storage cleanup failed", {
        userId: input.userId,
        bookmarkId,
        stage: "database-insert",
      }),
    );
    throw error;
  }

  void deps
    .categorize({
      userId: input.userId,
      bookmarkId,
      image: {
        mimeType: image.analysisMimeType,
        base64: image.analysisImage.toString("base64"),
      },
    })
    .catch((error) => console.warn("image AI analysis task failed", error));
  const thumbnailUrl = await signImage(deps.storage, paths.thumbnailPath).catch(
    () => {
      console.warn("image thumbnail signing failed", {
        userId: input.userId,
        bookmarkId,
      });
      return null;
    },
  );
  return mapBookmark(row, { thumbnailUrl, originalUrl: null });
}
