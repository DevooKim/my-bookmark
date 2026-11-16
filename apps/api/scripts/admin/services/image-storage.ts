import path from "node:path";
import type { ProcessedImage } from "./image-processing";

interface StorageErrorLike {
  message: string;
}

export interface ImageStorageBucket {
  download(path: string): Promise<{
    data: Blob | null;
    error: StorageErrorLike | null;
  }>;
}

export async function loadImageForAnalysis(
  storage: ImageStorageBucket,
  originalPath: string,
  processor: (bytes: Buffer, filename: string) => Promise<ProcessedImage>,
): Promise<{ mimeType: "image/jpeg"; base64: string }> {
  const result = await storage.download(originalPath);
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (!result.data) {
    throw new Error("Storage did not return image data");
  }
  const processed = await processor(
    Buffer.from(await result.data.arrayBuffer()),
    path.basename(originalPath),
  );
  return {
    mimeType: processed.analysisMimeType,
    base64: processed.analysisImage.toString("base64"),
  };
}
