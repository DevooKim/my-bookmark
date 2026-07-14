interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface HeicPreviewDependencies {
  decode: (input: { buffer: Uint8Array }) => Promise<DecodedImage>;
  createCanvas: () => HTMLCanvasElement;
}

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const MAX_PREVIEW_EDGE = 320;

export function isHeicFile(file: File): boolean {
  return (
    HEIC_MIME_TYPES.has(file.type.toLowerCase()) ||
    /\.(?:heic|heif)$/i.test(file.name)
  );
}

async function defaultDecode(input: {
  buffer: Uint8Array;
}): Promise<DecodedImage> {
  const module = await import("heic-decode");
  return module.default(input);
}

function defaultCreateCanvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("HEIC preview encoding failed"));
        }
      },
      "image/jpeg",
      0.82,
    );
  });
}

export async function createHeicPreviewBlob(
  file: File,
  dependencies: HeicPreviewDependencies = {
    decode: defaultDecode,
    createCanvas: defaultCreateCanvas,
  },
): Promise<Blob> {
  const decoded = await dependencies.decode({
    buffer: new Uint8Array(await file.arrayBuffer()),
  });
  const source = dependencies.createCanvas();
  source.width = decoded.width;
  source.height = decoded.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) {
    throw new Error("HEIC preview canvas is unavailable");
  }
  const pixelData = new Uint8ClampedArray(decoded.data.length);
  pixelData.set(decoded.data);
  sourceContext.putImageData(
    new ImageData(pixelData, decoded.width, decoded.height),
    0,
    0,
  );

  const scale = Math.min(
    1,
    MAX_PREVIEW_EDGE / Math.max(decoded.width, decoded.height),
  );
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const target = dependencies.createCanvas();
  target.width = width;
  target.height = height;
  const targetContext = target.getContext("2d");
  if (!targetContext) {
    throw new Error("HEIC preview canvas is unavailable");
  }
  targetContext.drawImage(source, 0, 0, width, height);
  return canvasBlob(target);
}
