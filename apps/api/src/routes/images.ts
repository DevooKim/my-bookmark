import { randomUUID } from "node:crypto";
import { API_ERROR_CODES } from "@my-bookmark/shared";
import type { RequestHandler } from "express";
import { Router } from "express";
import multer from "multer";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import {
  createImageBookmark,
  type ImageBookmarkCreationDeps,
} from "../services/image-bookmark-creation";
import { MAX_IMAGE_BYTES, processImage } from "../services/image-processing";
import { categorizeBookmarkForUser } from "./bookmarks";

const IMAGE_BUCKET = "bookmark-images";

export type ImageRouteDeps = ImageBookmarkCreationDeps;

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

    const bookmark = await createImageBookmark(
      {
        userId,
        bytes: request.file.buffer,
        filename: request.file.originalname,
      },
      getDependencies(),
    );
    response.status(201).json({
      bookmark,
    });
  });
  return router;
}

export function defaultImageDependencies(): ImageRouteDeps {
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

export async function createImageBookmarkForUser(input: {
  userId: string;
  bytes: Buffer;
  filename: string;
}) {
  return createImageBookmark(input, defaultImageDependencies());
}

export const imagesRouter = createImagesRouter(defaultImageDependencies);
