import path from "node:path";
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type ImageProcessingFailure = "invalid" | "too_large" | "unsupported";

export class ImageProcessingError extends Error {
  constructor(
    message: string,
    public readonly reason: ImageProcessingFailure,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImageProcessingError";
  }
}

export interface ProcessedImage {
  original: Buffer;
  thumbnail: Buffer;
  analysisImage: Buffer;
  analysisMimeType: "image/jpeg";
  extension: string;
  mimeType: string;
  width: number;
  height: number;
  filename: string;
}

const FORMAT_INFO = {
  gif: { extension: "gif", mimeType: "image/gif" },
  jpeg: { extension: "jpg", mimeType: "image/jpeg" },
  png: { extension: "png", mimeType: "image/png" },
  webp: { extension: "webp", mimeType: "image/webp" },
} as const;

export async function processImage(
  bytes: Buffer,
  filename: string,
): Promise<ProcessedImage> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageProcessingError(
      "이미지는 20MB 이하여야 합니다",
      "too_large",
    );
  }

  try {
    const image = sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: 64_000_000,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new ImageProcessingError(
        "이미지 정보를 읽을 수 없습니다",
        "invalid",
      );
    }

    const format = imageFormat(metadata.format, filename);
    const rotated = metadata.orientation && metadata.orientation >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    const normalizedName = normalizeFilename(filename, format.extension);
    const thumbnail = await image
      .clone()
      .rotate()
      .resize({
        width: 640,
        height: 640,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();
    const analysisImage = await image
      .clone()
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    return {
      original: bytes,
      thumbnail,
      analysisImage,
      analysisMimeType: "image/jpeg",
      extension: format.extension,
      mimeType: format.mimeType,
      width,
      height,
      filename: normalizedName,
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw error;
    }
    throw new ImageProcessingError(
      "이미지 파일을 읽을 수 없습니다",
      "invalid",
      { cause: error },
    );
  }
}

function imageFormat(
  format: string,
  filename: string,
): { extension: string; mimeType: string } {
  if (format === "gif") {
    return FORMAT_INFO.gif;
  }
  if (format === "jpeg") {
    return FORMAT_INFO.jpeg;
  }
  if (format === "png") {
    return FORMAT_INFO.png;
  }
  if (format === "webp") {
    return FORMAT_INFO.webp;
  }
  if (format === "heif") {
    const isHeic = path.extname(filename).toLowerCase() === ".heic";
    return isHeic
      ? { extension: "heic", mimeType: "image/heic" }
      : { extension: "heif", mimeType: "image/heif" };
  }
  throw new ImageProcessingError(
    "지원하지 않는 이미지 형식입니다",
    "unsupported",
  );
}

function normalizeFilename(filename: string, extension: string): string {
  const base = path.basename(filename).trim().slice(0, 255);
  return base || `image.${extension}`;
}
