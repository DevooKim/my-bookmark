import {
  API_ERROR_CODES,
  type Bookmark,
  type CreateBookmarkRequest,
  shareUrlItemSchema,
} from "@my-bookmark/shared";
import type { RequestHandler } from "express";
import { Router } from "express";
import multer from "multer";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { MAX_IMAGE_BYTES } from "../services/image-processing";
import { createLinkBookmarkForUser } from "./bookmarks";
import { createImageBookmarkForUser } from "./images";

interface ShareRouteDeps {
  createLink(input: {
    userId: string;
    request: CreateBookmarkRequest;
  }): Promise<Bookmark>;
  createImage(input: {
    userId: string;
    bytes: Buffer;
    filename: string;
  }): Promise<Bookmark>;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

export function createShareRouter(
  deps: ShareRouteDeps = {
    createLink: createLinkBookmarkForUser,
    createImage: createImageBookmarkForUser,
  },
  auth: RequestHandler = requireAuth({ apiKey: true }),
) {
  const router = Router();
  router.use("/share", auth);
  router.post("/share", upload.single("item"), async (request, response) => {
    const userId = getUserId(request);
    const rawItem = request.body?.item;
    const textItem =
      typeof rawItem === "string" && rawItem.length > 0 ? rawItem : null;
    if (Boolean(request.file) === Boolean(textItem)) {
      throw new HttpError(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        "링크 또는 이미지 하나가 필요합니다",
      );
    }

    const bookmark = request.file
      ? await deps.createImage({
          userId,
          bytes: request.file.buffer,
          filename: request.file.originalname,
        })
      : await deps.createLink({
          userId,
          request: {
            url: shareUrlItemSchema.parse({ item: textItem }).item,
            mode: "ai",
          },
        });
    response.status(201).json({ bookmark });
  });
  return router;
}

export const shareRouter = createShareRouter();
