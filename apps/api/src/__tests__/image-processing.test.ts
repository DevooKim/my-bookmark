import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, processImage } from "../services/image-processing";

describe("image processing", () => {
  it("preserves the original and creates bounded thumbnail and analysis images", async () => {
    const original = await sharp({
      create: {
        width: 1200,
        height: 600,
        channels: 3,
        background: "#336699",
      },
    })
      .png()
      .toBuffer();

    const result = await processImage(original, "sample.png");
    const thumbnail = await sharp(result.thumbnail).metadata();
    const analysis = await sharp(result.analysisImage).metadata();

    expect(result).toMatchObject({
      original,
      extension: "png",
      mimeType: "image/png",
      width: 1200,
      height: 600,
      filename: "sample.png",
      analysisMimeType: "image/jpeg",
    });
    expect(thumbnail.format).toBe("webp");
    expect(thumbnail.width).toBeLessThanOrEqual(640);
    expect(thumbnail.height).toBeLessThanOrEqual(640);
    expect(analysis.format).toBe("jpeg");
    expect(analysis.width).toBeLessThanOrEqual(2048);
    expect(analysis.height).toBeLessThanOrEqual(2048);
  });

  it("rejects oversized and undecodable input", async () => {
    await expect(
      processImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "large.jpg"),
    ).rejects.toMatchObject({ reason: "too_large" });
    await expect(
      processImage(Buffer.from("not an image"), "fake.jpg"),
    ).rejects.toMatchObject({ reason: "invalid" });
  });
});
