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
  saveAiProviderKey: vi.fn(),
  selectAiModel: vi.fn(),
  testAiProviderConnection: vi.fn(),
  updateCategory: vi.fn(),
}));

import {
  deleteAiProviderKey,
  getAiStatus,
  saveAiProviderKey,
  selectAiModel,
  testAiProviderConnection,
} from "../../lib/api-client";
import { AiSection, copyApiKeyToClipboard } from "./settings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const aiStatus = {
  provider: "gemini" as const,
  model: "gemini-flash-lite-latest" as const,
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
  it("renders independent API key controls for all providers", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    renderAiSection();

    await screen.findByRole("button", { name: "Gemini 키 삭제" });
    expect(screen.getByLabelText("Gemini API 키")).toBeTruthy();
    expect(screen.getByLabelText("Anthropic API 키")).toBeTruthy();
    expect(screen.getByLabelText("OpenAI API 키")).toBeTruthy();
  });

  it("saves one provider key without changing the model", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(saveAiProviderKey).mockResolvedValue({
      ...aiStatus,
      providers: {
        ...aiStatus.providers,
        anthropic: { configured: true },
      },
    });
    renderAiSection();

    fireEvent.change(await screen.findByLabelText("Anthropic API 키"), {
      target: { value: "new-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anthropic 키 저장" }));

    await waitFor(() =>
      expect(saveAiProviderKey).toHaveBeenCalledWith("anthropic", {
        apiKey: "new-secret",
      }),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Anthropic API 키") as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  it("shows models only for providers with a configured key", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    renderAiSection();

    await screen.findByRole("button", { name: "Gemini 키 삭제" });
    const selector = screen.getByLabelText("사용 모델") as HTMLSelectElement;
    expect(selector.querySelectorAll("optgroup")).toHaveLength(1);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /Claude/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /GPT/ })).toBeNull();
  });

  it("shows an empty state when no provider keys are configured", async () => {
    vi.mocked(getAiStatus).mockResolvedValue({
      ...aiStatus,
      enabled: false,
      providers: {
        gemini: { configured: false },
        anthropic: { configured: false },
        openai: { configured: false },
      },
    });
    renderAiSection();

    expect(
      await screen.findByText("먼저 provider API 키를 등록하세요"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("사용 모델")).toBeNull();
  });

  it("saves the selected model separately", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(selectAiModel).mockResolvedValue({
      ...aiStatus,
      model: "gemini-flash-latest",
    });
    renderAiSection();

    fireEvent.change(await screen.findByLabelText("사용 모델"), {
      target: { value: "gemini-flash-latest" },
    });
    fireEvent.click(screen.getByRole("button", { name: "모델 저장" }));

    await waitFor(() =>
      expect(selectAiModel).toHaveBeenCalledWith({
        provider: "gemini",
        model: "gemini-flash-latest",
      }),
    );
  });

  it("tests and deletes a configured provider key", async () => {
    vi.mocked(getAiStatus).mockResolvedValue(aiStatus);
    vi.mocked(testAiProviderConnection).mockResolvedValue({
      provider: "gemini",
      ok: true,
    });
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
      await screen.findByRole("button", { name: "Gemini 연결 테스트" }),
    );
    await waitFor(() =>
      expect(testAiProviderConnection).toHaveBeenCalledWith("gemini"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Gemini 키 삭제" }));
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
