import type { RequestHandler, Response } from "express";
import type { AlertDispatcher } from "../services/alerting";
import { createSlidingWindowCounter } from "../services/sliding-window";

function normalizedPath(originalUrl: string): string {
  return originalUrl.split("?", 1)[0] || "/";
}

function isSensitivePath(path: string): boolean {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // The raw malformed path remains useful for detection.
  }
  return (
    /(?:^|\/)\.(?:env|git)(?:\/|$)/i.test(decoded) ||
    /(?:^|\/)wp-admin(?:\/|$)/i.test(decoded) ||
    decoded.includes("../") ||
    decoded.includes("..\\")
  );
}

export function createSecurityMonitor({
  alerts,
  now = () => new Date(),
}: {
  alerts: AlertDispatcher;
  now?: () => Date;
}) {
  const timestamp = () => now().getTime();
  const auth = createSlidingWindowCounter({
    windowMs: 60_000,
    threshold: 5,
    now: timestamp,
  });
  const missing = createSlidingWindowCounter({
    windowMs: 5 * 60_000,
    threshold: 20,
    now: timestamp,
  });
  const malformed = createSlidingWindowCounter({
    windowMs: 10 * 60_000,
    threshold: 5,
    now: timestamp,
  });
  const limited = createSlidingWindowCounter({
    windowMs: 10 * 60_000,
    threshold: 20,
    now: timestamp,
  });

  const middleware: RequestHandler = (request, response, next) => {
    const path = normalizedPath(request.originalUrl);
    const sourceIp = request.ip ?? "unknown";
    if (isSensitivePath(path)) {
      void alerts.notify({
        fingerprint: `security:sensitive-path:${sourceIp}`,
        severity: "warning",
        title: "민감 경로 탐색",
        component: "security",
        summary: "민감한 서버 경로에 대한 접근이 감지되었습니다",
        occurredAt: now(),
        sourceIp,
        method: request.method,
        path,
      });
    }
    response.on("finish", () => {
      const locals: {
        securityRouteNotFound?: boolean;
        securityMalformed?: boolean;
      } = response.locals;
      let result: { crossed: boolean; count: number } | undefined;
      let fingerprint = "";
      let title = "";
      let windowLabel = "";
      if (response.statusCode === 401) {
        result = auth.record(sourceIp);
        fingerprint = `security:authentication:${sourceIp}`;
        title = "반복 인증 실패";
        windowLabel = "1분";
      } else if (
        locals.securityRouteNotFound === true ||
        response.statusCode === 405
      ) {
        result = missing.record(sourceIp);
        fingerprint = `security:route-scan:${sourceIp}`;
        title = "반복 경로 탐색";
        windowLabel = "5분";
      } else if (
        response.statusCode === 413 ||
        locals.securityMalformed === true
      ) {
        result = malformed.record(sourceIp);
        fingerprint = `security:malformed:${sourceIp}`;
        title = "반복 비정상 요청";
        windowLabel = "10분";
      } else if (response.statusCode === 429) {
        result = limited.record(sourceIp);
        fingerprint = `security:rate-limit:${sourceIp}`;
        title = "Rate limit 반복 도달";
        windowLabel = "10분";
      }
      if (result?.crossed) {
        void alerts.notify({
          fingerprint,
          severity: "warning",
          title,
          component: "security",
          summary: "동일 출처의 비정상 접근이 임계치를 넘었습니다",
          occurredAt: now(),
          sourceIp,
          method: request.method,
          path,
          status: response.statusCode,
          count: result.count,
          windowLabel,
        });
      }
    });
    next();
  };
  return {
    middleware,
    markMalformed(response: Response) {
      Object.assign(response.locals, { securityMalformed: true });
    },
  };
}
