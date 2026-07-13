import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, processImage } from "../services/image-processing";

describe("image processing", () => {
  it("decodes a real HEIC with the portable decoder", async () => {
    const heic = Buffer.from(
      "AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABhm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAOZpcHJwAAAAxWlwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAEAAAABAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAkwziHuRZVNwICBgCogABAAlEAcBhcshAUyQAAAAZaXBtYQAAAAAAAAABAAEGgQIDBYaEAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAboAAADIAAAAAW1kYXQAAAAAAAAA2AAAAMQoAa+hFbALoF9s2SZe+7Tvdr6eVFsRGbtk5mfwQbP2vj31zWWV9aOO8SwBgx1PxhMVQ7fL3qVYpi4ZR3TD84Ki8I7LbJzDAHRDqYQa1JRBrO7+qduwyB6pm4AHIHE8hkXrbOsTPy995kA5jPWzO7AHfTA1r0WnNqxrMid+VrSjJlJ6AgmfSJxYltnVmphqkwfr4rm6vs6FuBBsORLBHlY1H4prIQMkh5DwnfLfzFyr8E8VnoAbR9DnH7obQf/rxILjxqrY",
      "base64",
    );

    const result = await processImage(heic, "iphone.heic");
    const thumbnail = await sharp(result.thumbnail).metadata();

    expect(result).toMatchObject({
      original: heic,
      extension: "heic",
      mimeType: "image/heic",
      width: 16,
      height: 16,
      filename: "iphone.heic",
    });
    expect(thumbnail.format).toBe("webp");
  });

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
