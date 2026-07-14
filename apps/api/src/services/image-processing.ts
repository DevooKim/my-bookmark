import path from "node:path";
import decodeHeic from "heic-decode";
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
    const decoded = await decodeImage(bytes, filename);
    const { image, format, width, height } = decoded;
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
      .withIccProfile("srgb")
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
      .withIccProfile("srgb")
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

async function decodeImage(bytes: Buffer, filename: string) {
  if (isHeif(bytes, filename)) {
    const decoded = await decodeHeic({ buffer: bytes });
    if (
      decoded.width <= 0 ||
      decoded.height <= 0 ||
      decoded.width * decoded.height > 64_000_000
    ) {
      throw new ImageProcessingError(
        "이미지 크기를 처리할 수 없습니다",
        "invalid",
      );
    }
    const extension =
      path.extname(filename).toLowerCase() === ".heif" ? "heif" : "heic";
    return {
      image: sharp(Buffer.from(decoded.data), {
        raw: {
          width: decoded.width,
          height: decoded.height,
          channels: 4,
        },
      }),
      format: { extension, mimeType: `image/${extension}` },
      width: decoded.width,
      height: decoded.height,
    };
  }

  const image = sharp(bytes, {
    animated: false,
    failOn: "error",
    limitInputPixels: 64_000_000,
  });
  const metadata = await image.metadata();
  if (!metadata.format || !metadata.width || !metadata.height) {
    throw new ImageProcessingError("이미지 정보를 읽을 수 없습니다", "invalid");
  }
  const format = imageFormat(metadata.format);
  const rotated = metadata.orientation && metadata.orientation >= 5;
  return {
    image,
    format,
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
  };
}

function isHeif(bytes: Buffer, filename: string): boolean {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".heic" || extension === ".heif") {
    return true;
  }
  if (
    bytes.byteLength < 12 ||
    bytes.subarray(4, 8).toString("ascii") !== "ftyp"
  ) {
    return false;
  }
  return [
    "heic",
    "heix",
    "hevc",
    "hevx",
    "heim",
    "heis",
    "mif1",
    "msf1",
  ].includes(bytes.subarray(8, 12).toString("ascii"));
}

function imageFormat(format: string): { extension: string; mimeType: string } {
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
  throw new ImageProcessingError(
    "지원하지 않는 이미지 형식입니다",
    "unsupported",
  );
}

function normalizeFilename(filename: string, extension: string): string {
  const base = path.basename(filename).trim().slice(0, 255);
  return base || `image.${extension}`;
}
