import type { ProcessedImage } from "./image-processing";

interface StorageErrorLike {
  message: string;
}

interface StorageResult {
  error: StorageErrorLike | null;
}

export interface ImageStorageBucket {
  upload(
    path: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean },
  ): Promise<StorageResult>;
  remove(paths: string[]): Promise<StorageResult>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{
    data: { signedUrl: string } | null;
    error: StorageErrorLike | null;
  }>;
}

export interface StoredImagePaths {
  originalPath: string;
  thumbnailPath: string;
}

export async function storeImage({
  storage,
  userId,
  bookmarkId,
  image,
}: {
  storage: ImageStorageBucket;
  userId: string;
  bookmarkId: string;
  image: ProcessedImage;
}): Promise<StoredImagePaths> {
  const paths = {
    originalPath: `${userId}/${bookmarkId}/original.${image.extension}`,
    thumbnailPath: `${userId}/${bookmarkId}/thumbnail.webp`,
  };
  const original = await storage.upload(paths.originalPath, image.original, {
    contentType: image.mimeType,
    upsert: false,
  });
  if (original.error) {
    throw new Error(original.error.message);
  }

  const thumbnail = await storage.upload(paths.thumbnailPath, image.thumbnail, {
    contentType: "image/webp",
    upsert: false,
  });
  if (thumbnail.error) {
    const cleanup = await storage.remove([paths.originalPath]);
    if (cleanup.error) {
      console.warn("image original cleanup failed", {
        bookmarkId,
        userId,
        stage: "thumbnail-upload",
      });
    }
    throw new Error(thumbnail.error.message);
  }
  return paths;
}

export async function removeImage(
  storage: ImageStorageBucket,
  paths: StoredImagePaths,
): Promise<void> {
  const result = await storage.remove([
    paths.originalPath,
    paths.thumbnailPath,
  ]);
  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function signImage(
  storage: ImageStorageBucket,
  path: string,
  expiresIn = 600,
): Promise<string> {
  const result = await storage.createSignedUrl(path, expiresIn);
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (!result.data) {
    throw new Error("Storage did not return a signed URL");
  }
  return result.data.signedUrl;
}
