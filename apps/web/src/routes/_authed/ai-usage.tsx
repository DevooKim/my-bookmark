import type { AiUsageEvent } from "@my-bookmark/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { getAiAccountUsage, getAiUsage } from "../../lib/api-client";

export const Route = createFileRoute("/_authed/ai-usage")({
  component: AiUsagePage,
});

const dayOptions = [7, 30, 90] as const;

export function aggregateUsage(events: AiUsageEvent[]): {
  totals: {
    provider: AiUsageEvent["provider"];
    model: string;
    success: number;
    failed: number;
  }[];
  daily: { date: string; count: number }[];
} {
  const totalsByModel = new Map<
    string,
    {
      provider: AiUsageEvent["provider"];
      model: string;
      success: number;
      failed: number;
    }
  >();
  const countsByDate = new Map<string, number>();
  for (const event of events) {
    const total = totalsByModel.get(event.model) ?? {
      provider: event.provider,
      model: event.model,
      success: 0,
      failed: 0,
    };
    total[event.status === "success" ? "success" : "failed"] += 1;
    totalsByModel.set(event.model, total);
    const date = new Date(event.createdAt).toLocaleDateString("sv-SE");
    countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
  }
  return {
    totals: [...totalsByModel.values()].sort(
      (a, b) => b.success + b.failed - (a.success + a.failed),
    ),
    daily: [...countsByDate.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

export function modelLabel(model: string): string {
  return model;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function AiUsagePage() {
  const [days, setDays] = useState<number>(30);
  const usageQuery = useQuery({
    queryKey: ["aiUsage", days],
    queryFn: () => getAiUsage(days),
  });
  const accountQuery = useQuery({
    queryKey: ["aiAccount"],
    queryFn: getAiAccountUsage,
    retry: false,
  });
  const account = accountQuery.data;
  const events = usageQuery.data?.items ?? [];
  const { totals, daily } = aggregateUsage(events);
  const maxTotal = Math.max(1, ...totals.map((t) => t.success + t.failed));
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  return (
    <main className="page-stack">
      <section className="page-header">
        <div>
          <p className="page-eyebrow">Insights</p>
          <h1 className="page-title">AI 사용량</h1>
          <p className="page-subtitle">
            언제 어떤 모델로 분류했는지 확인합니다.
          </p>
        </div>
      </section>

      {account ? (
        <section
          aria-label="계정 사용액"
          className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-bold">OpenRouter 계정 사용액</h2>
            {account.isFreeTier ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                Free tier
              </span>
            ) : null}
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <dt className="text-xs text-zinc-500">오늘</dt>
              <dd className="mt-1 font-semibold">
                {formatUsd(account.usageDaily)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">이번 주</dt>
              <dd className="mt-1 font-semibold">
                {formatUsd(account.usageWeekly)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">이번 달</dt>
              <dd className="mt-1 font-semibold">
                {formatUsd(account.usageMonthly)}
              </dd>
            </div>
          </dl>
          {account.limit !== null ? (
            <p className="mt-3 text-xs text-zinc-500">
              한도 {formatUsd(account.limit)} 중 잔여{" "}
              {formatUsd(account.limitRemaining ?? 0)}
            </p>
          ) : null}
          <a
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600"
            href="https://openrouter.ai/activity"
            rel="noreferrer"
            target="_blank"
          >
            모델별 비용 상세는 OpenRouter Activity에서 →
          </a>
        </section>
      ) : null}

      <div className="flex gap-2">
        {dayOptions.map((option) => (
          <button
            className={days === option ? "chip-active" : "chip"}
            key={option}
            onClick={() => setDays(option)}
            type="button"
          >
            {option}일
          </button>
        ))}
      </div>

      <section
        aria-label="모델별 사용량"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-bold">모델별 호출</h2>
        {totals.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            아직 기록된 사용량이 없어요.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {totals.map((total) => {
              const sum = total.success + total.failed;
              return (
                <li key={total.model}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {modelLabel(total.model)}
                    </span>
                    <span className="text-xs text-zinc-500">
                      성공 {total.success} · 실패 {total.failed}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${(sum / maxTotal) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-label="일별 사용량"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-bold">일별 호출</h2>
        <ul className="mt-3 space-y-2">
          {daily.map((day) => (
            <li className="flex items-center gap-3 text-sm" key={day.date}>
              <span className="w-24 shrink-0 text-zinc-500">{day.date}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${(day.count / maxDaily) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-zinc-500">{day.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="최근 이벤트"
        className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="font-bold">최근 이벤트</h2>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
          {events.slice(0, 20).map((event) => (
            <li className="flex items-center gap-3 py-2 text-sm" key={event.id}>
              <span className="w-40 shrink-0 text-xs text-zinc-500">
                {new Date(event.createdAt).toLocaleString()}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {modelLabel(event.model)}
              </span>
              {event.status === "success" ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-200">
                  성공
                </span>
              ) : (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
                  실패{event.errorCode ? ` ` : ""}
                  {event.errorCode ? (
                    <span className="ml-1">{event.errorCode}</span>
                  ) : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
