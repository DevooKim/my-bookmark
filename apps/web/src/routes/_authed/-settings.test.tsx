import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client", () => ({
  createApiKey: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  getAiStatus: vi.fn(),
  listApiKeys: vi.fn(),
  listCategories: vi.fn(),
  revokeApiKey: vi.fn(),
  updateCategory: vi.fn(),
}));

import { copyApiKeyToClipboard } from "./settings";

describe("copyApiKeyToClipboard", () => {
  it("reports success only after the clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const success = vi.fn();
    const error = vi.fn();

    await copyApiKeyToClipboard("bm_secret", { writeText, success, error });

    expect(writeText).toHaveBeenCalledWith("bm_secret");
    expect(success).toHaveBeenCalledWith("복사했어요");
    expect(error).not.toHaveBeenCalled();
  });

  it("reports copy failures instead of claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const success = vi.fn();
    const error = vi.fn();

    await copyApiKeyToClipboard("bm_secret", { writeText, success, error });

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "복사하지 못했어요. 직접 선택해서 복사하세요.",
    );
  });
});
