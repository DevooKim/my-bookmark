// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client", () => ({
  getAiAnalytics: vi.fn(),
  getAiUsage: vi.fn(),
  getAiAccountUsage: vi.fn(),
}));

import {
  getAiAccountUsage,
  getAiAnalytics,
  getAiUsage,
} from "../../lib/api-client";
import { AiUsagePage, aggregateAnalytics, aggregateUsage } from "./ai-usage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const events = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    provider: "gemini" as const,
    model: "gemini-flash-lite-latest",
    bookmarkId: null,
    status: "success" as const,
    errorCode: null,
    durationMs: 700,
    isByok: true,
    createdAt: "2026-07-12T10:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    provider: "gemini" as const,
    model: "gemini-flash-lite-latest",
    bookmarkId: null,
    status: "failed" as const,
    errorCode: "429",
    durationMs: 400,
    isByok: null,
    createdAt: "2026-07-12T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    provider: "anthropic" as const,
    model: "claude-haiku-4-5",
    bookmarkId: null,
    status: "success" as const,
    errorCode: null,
    durationMs: 900,
    isByok: false,
    createdAt: "2026-07-11T10:00:00.000Z",
  },
];

describe("aggregateUsage", () => {
  it("aggregates totals per model and daily counts in local time", () => {
    const { totals, daily } = aggregateUsage(events);
    expect(totals).toEqual([
      {
        provider: "gemini",
        model: "gemini-flash-lite-latest",
        success: 1,
        failed: 1,
      },
      {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        success: 1,
        failed: 0,
      },
    ]);
    expect(daily.reduce((sum, day) => sum + day.count, 0)).toBe(3);
  });
});

const account = {
  usage: 12.3456,
  usageDaily: 0.5,
  usageWeekly: 2.25,
  usageMonthly: 12.3456,
  limit: 20,
  limitRemaining: 7.6544,
  isFreeTier: false,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AiUsagePage />
    </QueryClientProvider>,
  );
}

describe("AiUsagePage", () => {
  it("renders model totals and the recent event list", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: events });
    vi.mocked(getAiAccountUsage).mockResolvedValue(account);
    renderPage();

    const totalsSection = within(
      screen.getByRole("region", { name: "모델별 사용량" }),
    );
    const geminiLabel = await totalsSection.findByText(
      "gemini-flash-lite-latest",
    );
    expect(geminiLabel).toBeTruthy();
    const geminiRow = geminiLabel.closest("li");
    expect(geminiRow).not.toBeNull();
    expect(within(geminiRow as HTMLElement).getByText(/성공 1/)).toBeTruthy();
    expect(screen.getByText("429")).toBeTruthy();
    expect(screen.getByText("BYOK")).toBeTruthy();
    expect(screen.getByText("크레딧")).toBeTruthy();
  });

  it("shows the OpenRouter account usage card with today/week/month USD", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: events });
    vi.mocked(getAiAccountUsage).mockResolvedValue(account);
    renderPage();

    const accountSection = within(
      await screen.findByRole("region", { name: "계정 사용액" }),
    );
    expect(accountSection.getByText("$0.5000")).toBeTruthy();
    expect(accountSection.getByText("$2.2500")).toBeTruthy();
    expect(accountSection.getByText("$12.3456")).toBeTruthy();
  });

  it("links out to the OpenRouter activity dashboard", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: events });
    vi.mocked(getAiAccountUsage).mockResolvedValue(account);
    renderPage();

    const link = await screen.findByRole("link", {
      name: /OpenRouter Activity/,
    });
    expect(link.getAttribute("href")).toBe("https://openrouter.ai/activity");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders the rest of the page normally when the account query fails", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: events });
    vi.mocked(getAiAccountUsage).mockRejectedValue(new Error("no key"));
    renderPage();

    const totalsSection = within(
      screen.getByRole("region", { name: "모델별 사용량" }),
    );
    expect(
      await totalsSection.findByText("gemini-flash-lite-latest"),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "계정 사용액" })).toBeNull();
  });
});

describe("OpenRouter analytics", () => {
  const analyticsRows = [
    {
      date: "2026-07-12",
      model: "google/gemini-3.1-flash-lite-20260507",
      usage: 0.019993,
      tokens: 38437,
      requests: 45,
    },
    {
      date: "2026-07-12",
      model: "openai/gpt-4o-mini",
      usage: 0.000207,
      tokens: 900,
      requests: 1,
    },
    {
      date: "2026-07-13",
      model: "google/gemini-3.1-flash-lite-20260507",
      usage: 0.002,
      tokens: 4000,
      requests: 4,
    },
  ];

  it("aggregates analytics rows per model and per day", () => {
    const { models, dailyCost } = aggregateAnalytics(analyticsRows);
    expect(models[0]).toEqual({
      model: "google/gemini-3.1-flash-lite-20260507",
      usage: 0.021993,
      tokens: 42437,
      requests: 49,
    });
    expect(dailyCost[0]?.date).toBe("2026-07-13");
    expect(dailyCost).toHaveLength(2);
  });

  it("renders the OpenRouter cost section when analytics are configured", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: [] });
    vi.mocked(getAiAccountUsage).mockRejectedValue(new Error("skip"));
    vi.mocked(getAiAnalytics).mockResolvedValue({
      days: 30,
      configured: true,
      rows: analyticsRows,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AiUsagePage />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("모델별 비용·토큰 (OpenRouter)"),
    ).toBeTruthy();
    expect(screen.getByText(/42,437/)).toBeTruthy();
    expect(screen.getByText(/\$0\.0220/)).toBeTruthy();
  });

  it("hides the OpenRouter cost section without a management key", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: [] });
    vi.mocked(getAiAccountUsage).mockRejectedValue(new Error("skip"));
    vi.mocked(getAiAnalytics).mockResolvedValue({
      days: 30,
      configured: false,
      rows: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AiUsagePage />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "AI 사용량" });
    expect(screen.queryByText("모델별 비용·토큰 (OpenRouter)")).toBeNull();
  });
});
