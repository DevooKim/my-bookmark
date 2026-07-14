import { afterEach, describe, expect, it, vi } from "vitest";
import { createHeicPreviewBlob, isHeicFile } from "./heic-preview";

interface FakeCanvas {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
}

function canvas(
  context: object | null,
  blob: Blob | null = new Blob(["jpeg"]),
) {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
  } satisfies FakeCanvas;
}

function asCanvas(value: FakeCanvas): HTMLCanvasElement {
  return value as unknown as HTMLCanvasElement;
}

afterEach(() => vi.unstubAllGlobals());

describe("isHeicFile", () => {
  it("detects HEIC and HEIF by MIME type or extension", () => {
    expect(
      isHeicFile(new File(["image"], "photo.bin", { type: "image/heic" })),
    ).toBe(true);
    expect(
      isHeicFile(
        new File(["image"], "photo.HEIF", {
          type: "application/octet-stream",
        }),
      ),
    ).toBe(true);
    expect(
      isHeicFile(new File(["image"], "photo.jpg", { type: "image/jpeg" })),
    ).toBe(false);
  });
});

describe("createHeicPreviewBlob", () => {
  it("decodes RGBA and creates a bounded JPEG preview", async () => {
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
    );
    const sourceContext = { putImageData: vi.fn() };
    const targetContext = { drawImage: vi.fn() };
    const source = canvas(sourceContext);
    const target = canvas(
      targetContext,
      new Blob(["preview"], { type: "image/jpeg" }),
    );
    const createCanvas = vi
      .fn<() => HTMLCanvasElement>()
      .mockReturnValueOnce(asCanvas(source))
      .mockReturnValueOnce(asCanvas(target));
    const decode = vi.fn().mockResolvedValue({
      width: 1000,
      height: 2000,
      data: new Uint8ClampedArray(1000 * 2000 * 4),
    });
    const file = new File([new Uint8Array([1, 2, 3])], "photo.heic", {
      type: "image/heic",
    });

    const preview = await createHeicPreviewBlob(file, {
      decode,
      createCanvas,
    });

    expect(decode).toHaveBeenCalledWith({ buffer: expect.any(Uint8Array) });
    expect(source).toMatchObject({ width: 1000, height: 2000 });
    expect(target).toMatchObject({ width: 160, height: 320 });
    expect(sourceContext.putImageData).toHaveBeenCalledOnce();
    expect(targetContext.drawImage).toHaveBeenCalledWith(
      asCanvas(source),
      0,
      0,
      160,
      320,
    );
    expect(target.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.82,
    );
    expect(preview.type).toBe("image/jpeg");
  });

  it("rejects when canvas conversion is unavailable", async () => {
    const decode = vi.fn().mockResolvedValue({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    });
    await expect(
      createHeicPreviewBlob(
        new File(["image"], "photo.heic", { type: "image/heic" }),
        {
          decode,
          createCanvas: () => asCanvas(canvas(null)),
        },
      ),
    ).rejects.toThrow("HEIC preview canvas is unavailable");
  });

  it("rejects when the browser cannot encode the preview blob", async () => {
    vi.stubGlobal("ImageData", class {});
    const canvases = [
      canvas({ putImageData: vi.fn() }),
      canvas({ drawImage: vi.fn() }, null),
    ];
    await expect(
      createHeicPreviewBlob(
        new File(["image"], "photo.heic", { type: "image/heic" }),
        {
          decode: vi.fn().mockResolvedValue({
            width: 1,
            height: 1,
            data: new Uint8ClampedArray(4),
          }),
          createCanvas: () => asCanvas(canvases.shift() ?? canvas(null)),
        },
      ),
    ).rejects.toThrow("HEIC preview encoding failed");
  });
});
