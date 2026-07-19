import { type AlertDispatcher, defaultAlertDispatcher } from "./alerting";
import type { AiUsageEventInput } from "./categorize";
import { defaultReadinessService, type ReadinessService } from "./readiness";
import { createSlidingWindowCounter } from "./sliding-window";

export interface ReminderRunResult {
  scanned: number;
  claimed: number;
  sent: number;
  failed: number;
  expired: number;
}

export interface OperationalMonitor {
  recordAiUsage(event: AiUsageEventInput): void;
  recordCronFailure(error: unknown): void;
  recordCronSuccess(result: ReminderRunResult): void;
  recordUnexpectedHttpError(input: {
    status: number;
    method: string;
    path: string;
    requestId?: string;
  }): void;
}

export function createOperationalMonitor({
  alerts,
  readiness,
  now = () => new Date(),
}: {
  alerts: AlertDispatcher;
  readiness: ReadinessService;
  now?: () => Date;
}): OperationalMonitor {
  const aiFailures = createSlidingWindowCounter({
    windowMs: 15 * 60_000,
    threshold: 5,
    now: () => now().getTime(),
  });
  let consecutiveAiFailures = 0;
  let lastAiFailureAt = 0;
  let cronFailed = false;
  let fullScans = 0;
  let partialPushFailures = 0;
  let partialPushStartedAt = 0;

  const notify = (event: Parameters<AlertDispatcher["notify"]>[0]) => {
    void alerts.notify(event);
  };
  return {
    recordAiUsage(event) {
      if (event.status === "success") {
        consecutiveAiFailures = 0;
        return;
      }
      const timestamp = now().getTime();
      if (timestamp - lastAiFailureAt > 15 * 60_000) consecutiveAiFailures = 0;
      lastAiFailureAt = timestamp;
      consecutiveAiFailures += 1;
      const total = aiFailures.record("all");
      if (consecutiveAiFailures === 3) {
        notify({
          fingerprint: "ai:consecutive-failures",
          severity: "warning",
          title: "AI 분석 연속 실패",
          component: "ai",
          summary: "AI 분석이 3회 연속 실패했습니다",
          occurredAt: now(),
          count: 3,
          windowLabel: "15분",
        });
      } else if (total.crossed) {
        notify({
          fingerprint: "ai:failure-volume",
          severity: "warning",
          title: "AI 분석 실패 증가",
          component: "ai",
          summary: "AI 분석 실패량이 임계치를 넘었습니다",
          occurredAt: now(),
          count: total.count,
          windowLabel: "15분",
        });
      }
    },
    recordCronFailure() {
      readiness.markCronFailure();
      if (cronFailed) return;
      cronFailed = true;
      notify({
        fingerprint: "reminder:cron-failure",
        severity: "critical",
        title: "리마인더 cron 실패",
        component: "reminder-cron",
        summary: "리마인더 cron 실행 중 예외가 발생했습니다",
        occurredAt: now(),
      });
    },
    recordCronSuccess(result) {
      readiness.markCronSuccess(now());
      if (cronFailed) {
        cronFailed = false;
        notify({
          fingerprint: "reminder:cron-recovered",
          severity: "recovered",
          title: "리마인더 cron 복구",
          component: "reminder-cron",
          summary: "리마인더 cron이 다시 정상 실행되었습니다",
          occurredAt: now(),
        });
      }
      fullScans = result.scanned === 20 ? fullScans + 1 : 0;
      if (fullScans === 3) {
        notify({
          fingerprint: "reminder:backlog",
          severity: "warning",
          title: "리마인더 backlog 감지",
          component: "reminder-cron",
          summary: "리마인더 조회 한도가 3회 연속 가득 찼습니다",
          occurredAt: now(),
          count: 3,
          windowLabel: "3분",
        });
      }
      if (result.claimed > 0 && result.sent === 0 && result.failed > 0) {
        notify({
          fingerprint: "push:all-deliveries-failed",
          severity: "warning",
          title: "리마인더 Push 전송 실패",
          component: "push",
          summary: "클레임한 리마인더의 모든 유효 Push 전송이 실패했습니다",
          occurredAt: now(),
          count: result.failed,
        });
      } else if (result.sent > 0 && result.failed > 0) {
        if (partialPushFailures === 0) partialPushStartedAt = now().getTime();
        partialPushFailures += result.failed;
      }
      if (
        partialPushFailures > 0 &&
        now().getTime() - partialPushStartedAt >= 15 * 60_000
      ) {
        notify({
          fingerprint: "push:partial-failures",
          severity: "warning",
          title: "Push 일부 전송 실패",
          component: "push",
          summary: "일부 Push 전송 실패가 누적되었습니다",
          occurredAt: now(),
          count: partialPushFailures,
          windowLabel: "15분",
        });
        partialPushFailures = 0;
      }
    },
    recordUnexpectedHttpError(input) {
      notify({
        fingerprint: `http:unexpected:${input.status}`,
        severity: input.status >= 500 ? "critical" : "warning",
        title: "예상하지 못한 API 오류",
        component: "api",
        summary: "API가 서버 오류를 반환했습니다",
        occurredAt: now(),
        method: input.method,
        path: input.path,
        status: input.status,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      });
    },
  };
}

export const defaultOperationalMonitor = createOperationalMonitor({
  alerts: defaultAlertDispatcher,
  readiness: defaultReadinessService,
});
