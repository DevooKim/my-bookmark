// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api-client", () => ({ getAiUsage: vi.fn() }));

import { getAiUsage } from "../../lib/api-client";
import { AiUsagePage, aggregateUsage } from "./ai-usage";

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

describe("AiUsagePage", () => {
  it("renders model totals and the recent event list", async () => {
    vi.mocked(getAiUsage).mockResolvedValue({ days: 30, items: events });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AiUsagePage />
      </QueryClientProvider>,
    );

    const totalsSection = within(
      screen.getByRole("region", { name: "모델별 사용량" }),
    );
    const geminiLabel = await totalsSection.findByText("Gemini Flash Lite");
    expect(geminiLabel).toBeTruthy();
    const geminiRow = geminiLabel.closest("li");
    expect(geminiRow).not.toBeNull();
    expect(within(geminiRow as HTMLElement).getByText(/성공 1/)).toBeTruthy();
    expect(screen.getByText("429")).toBeTruthy();
  });
});
