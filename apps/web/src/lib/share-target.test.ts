import { describe, expect, it } from "vitest";
import {
  deleteSharedImages,
  loadSharedImages,
  type ShareTargetRecord,
  type ShareTargetStore,
  stageSharedImages,
} from "./share-target";

class MemoryShareTargetStore implements ShareTargetStore {
  readonly records = new Map<string, ShareTargetRecord>();

  async put(record: ShareTargetRecord) {
    this.records.set(record.id, record);
  }

  async get(id: string) {
    return this.records.get(id);
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

describe("share target staging", () => {
  it("stages and restores image files without losing metadata", async () => {
    const store = new MemoryShareTargetStore();
    const file = new File(["image"], "photo.heic", {
      type: "image/heic",
      lastModified: 123,
    });

    const id = await stageSharedImages([file], store);
    const restored = await loadSharedImages(id, store);

    expect(id).toBeTruthy();
    if (!restored) {
      throw new Error("staged images were not restored");
    }
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      name: "photo.heic",
      type: "image/heic",
      lastModified: 123,
    });
    await expect(restored[0]?.text()).resolves.toBe("image");

    await deleteSharedImages(id, store);
    await expect(loadSharedImages(id, store)).resolves.toBeNull();
  });

  it("rejects a batch with no images", async () => {
    const store = new MemoryShareTargetStore();
    const text = new File(["no"], "note.txt", { type: "text/plain" });

    await expect(stageSharedImages([text], store)).rejects.toThrow(
      "공유된 이미지가 없습니다",
    );
  });
});
