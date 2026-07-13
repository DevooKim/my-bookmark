import { randomUUID } from "node:crypto";
import { API_ERROR_CODES } from "@my-bookmark/shared";
import type { RequestHandler } from "express";
import { Router } from "express";
import multer from "multer";
import { type BookmarkDbRow, mapBookmark } from "../lib/db-mappers";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import {
  ImageProcessingError,
  MAX_IMAGE_BYTES,
  type ProcessedImage,
  processImage,
} from "../services/image-processing";
import {
  type ImageStorageBucket,
  removeImage,
  signImage,
  storeImage,
} from "../services/image-storage";
import { categorizeBookmarkForUser } from "./bookmarks";

const IMAGE_BUCKET = "bookmark-images";

interface ImageInsert {
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

interface ImageRouteDeps {
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

export function createImagesRouter(
  dependencies: ImageRouteDeps | (() => ImageRouteDeps),
  auth: RequestHandler = requireAuth({ apiKey: true }),
) {
  const router = Router();
  const getDependencies =
    typeof dependencies === "function" ? dependencies : () => dependencies;
  router.use("/images", auth);
  router.post("/images", upload.single("image"), async (request, response) => {
    const userId = getUserId(request);
    if (!request.file) {
      throw new HttpError(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        "이미지 파일이 필요합니다",
      );
    }

    const deps = getDependencies();
    let image: ProcessedImage;
    try {
      image = await deps.processImage(
        request.file.buffer,
        request.file.originalname,
      );
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
      userId,
      bookmarkId,
      image,
    });
    let row: BookmarkDbRow;
    try {
      row = await deps.insertImage({
        id: bookmarkId,
        user_id: userId,
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
          userId,
          bookmarkId,
          stage: "database-insert",
        }),
      );
      throw error;
    }

    void deps
      .categorize({
        userId,
        bookmarkId,
        image: {
          mimeType: image.analysisMimeType,
          base64: image.analysisImage.toString("base64"),
        },
      })
      .catch((error) => console.warn("image AI analysis task failed", error));
    const thumbnailUrl = await signImage(
      deps.storage,
      paths.thumbnailPath,
    ).catch(() => {
      console.warn("image thumbnail signing failed", {
        userId,
        bookmarkId,
      });
      return null;
    });
    response.status(201).json({
      bookmark: mapBookmark(row, { thumbnailUrl, originalUrl: null }),
    });
  });
  return router;
}

function defaultDependencies(): ImageRouteDeps {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  const db = supabaseAdmin;
  const storage = db.storage.from(IMAGE_BUCKET);
  return {
    storage,
    randomUUID,
    processImage,
    async insertImage(row) {
      const { data, error } = await db
        .from("bookmarks")
        .insert(row)
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return data;
    },
    async categorize({ userId, bookmarkId, image }) {
      await categorizeBookmarkForUser({
        db,
        userId,
        bookmarkId,
        imageInput: image,
      });
    },
  };
}

export const imagesRouter = createImagesRouter(defaultDependencies);
