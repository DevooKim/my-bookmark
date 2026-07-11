// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client", () => ({
  createApiKey: vi.fn(),
  createCategory: vi.fn(),
  deleteAiProviderKey: vi.fn(),
  deleteCategory: vi.fn(),
  getAiStatus: vi.fn(),
  listApiKeys: vi.fn(),
  listCategories: vi.fn(),
  revokeApiKey: vi.fn(),
  updateAiSettings: vi.fn(),
  updateCategory: vi.fn(),
}));

import {
  deleteAiProviderKey,
  getAiStatus,
  updateAiSettings,
} from "../../lib/api-client";
import { AiSection, copyApiKeyToClipboard } from "./settings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const aiStatus = {
  provider: "gemini" as const,
  enabled: true,
  providers: {
    gemini: { configured: true },
    anthropic: { configured: false },
    openai: { configured: false },
  },
};

function renderAiSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiSection />
    </QueryClientProvider>,
  );
}

describe("AI settings", () => {
  it("selects a provider and saves its replacement key", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(updateAiSettings).mockResolvedValue({
      ...aiStatus,
      provider: "anthropic",
      enabled: true,
      providers: {
        ...aiStatus.providers,
        anthropic: { configured: true },
      },
    });
    renderAiSection();

    await screen.findByRole("button", { name: "Gemini 키 삭제" });
    fireEvent.change(screen.getByLabelText("AI provider"), {
      target: { value: "anthropic" },
    });
    fireEvent.change(screen.getByLabelText("Anthropic API 키"), {
      target: { value: "new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "AI 설정 저장" }));

    await waitFor(() =>
      expect(updateAiSettings).toHaveBeenCalledWith({
        provider: "anthropic",
        apiKey: "new-secret",
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Anthropic API 키") as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  it("deletes a configured provider key", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(deleteAiProviderKey).mockResolvedValue({
      ...aiStatus,
      enabled: false,
      providers: {
        ...aiStatus.providers,
        gemini: { configured: false },
      },
    });
    renderAiSection();

    fireEvent.click(
      await screen.findByRole("button", { name: "Gemini 키 삭제" }),
    );

    await waitFor(() =>
      expect(deleteAiProviderKey).toHaveBeenCalledWith("gemini"),
    );
  });
});

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
