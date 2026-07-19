import { appEnv } from "../lib/env";

export type AlertSeverity = "critical" | "warning" | "recovered";

export interface AlertEvent {
  fingerprint: string;
  severity: AlertSeverity;
  title: string;
  component: string;
  summary: string;
  occurredAt: Date;
  sourceIp?: string;
  method?: string;
  path?: string;
  status?: number;
  count?: number;
  windowLabel?: string;
  requestId?: string;
}

export interface AlertDispatcher {
  notify(event: AlertEvent): Promise<void>;
}

const severityStyle = {
  critical: { emoji: "🔴", label: "CRITICAL", color: 0xdc2626 },
  warning: { emoji: "🟡", label: "WARNING", color: 0xf59e0b },
  recovered: { emoji: "🟢", label: "RECOVERED", color: 0x16a34a },
} as const;

export function buildDiscordPayload(event: AlertEvent, environment: string) {
  const style = severityStyle[event.severity];
  const fields = [
    { name: "환경", value: environment, inline: true },
    { name: "컴포넌트", value: event.component, inline: true },
    ...(event.sourceIp
      ? [{ name: "출처 IP", value: event.sourceIp, inline: true }]
      : []),
    ...(event.method
      ? [{ name: "Method", value: event.method, inline: true }]
      : []),
    ...(event.path ? [{ name: "경로", value: event.path, inline: true }] : []),
    ...(event.status
      ? [{ name: "상태", value: String(event.status), inline: true }]
      : []),
    ...(event.count
      ? [
          {
            name: "발생량",
            value: `${event.windowLabel ? `최근 ${event.windowLabel} ` : ""}${event.count}회`,
            inline: true,
          },
        ]
      : []),
    ...(event.requestId
      ? [{ name: "Request ID", value: event.requestId, inline: false }]
      : []),
    { name: "오류 ID", value: event.fingerprint, inline: false },
  ];
  return {
    embeds: [
      {
        title: `${style.emoji} [${style.label}] ${event.title}`,
        description: event.summary,
        color: style.color,
        fields,
        footer: {
          text: new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            dateStyle: "medium",
            timeStyle: "medium",
          }).format(event.occurredAt),
        },
        timestamp: event.occurredAt.toISOString(),
      },
    ],
  };
}

export class DiscordAlertDeliveryError extends Error {
  constructor() {
    super("Discord alert delivery failed");
  }
}

export function createDiscordAlertSink({
  webhookUrl,
  alertEnvironment,
  fetchImpl = fetch,
  sleep = (milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 3_000,
}: {
  webhookUrl?: string;
  alertEnvironment: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}) {
  return async (event: AlertEvent): Promise<void> => {
    if (!webhookUrl) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildDiscordPayload(event, alertEnvironment)),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return;
        if (
          attempt === 0 &&
          (response.status === 429 || response.status >= 500)
        ) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          await sleep(
            response.status === 429 && Number.isFinite(retryAfter)
              ? Math.min(retryAfter * 1_000, 3_000)
              : 250,
          );
          continue;
        }
      } catch {
        if (attempt === 0) {
          await sleep(250);
          continue;
        }
      }
      throw new DiscordAlertDeliveryError();
    }
    throw new DiscordAlertDeliveryError();
  };
}

export function createDeduplicatingDispatcher({
  send,
  now = () => new Date(),
  cooldownMs = 10 * 60_000,
  onDeliveryError = (error) =>
    console.warn("Discord alert delivery failed", error),
}: {
  send: (event: AlertEvent) => Promise<void>;
  now?: () => Date;
  cooldownMs?: number;
  onDeliveryError?: (error: unknown) => void;
}): AlertDispatcher {
  const states = new Map<string, { sentAt: number; suppressed: number }>();
  return {
    async notify(event) {
      const timestamp = now().getTime();
      for (const [key, state] of states) {
        if (timestamp - state.sentAt > cooldownMs * 2) states.delete(key);
      }
      const state = states.get(event.fingerprint);
      if (state && timestamp - state.sentAt < cooldownMs) {
        state.suppressed += 1;
        return;
      }
      try {
        await send({
          ...event,
          ...(state?.suppressed
            ? { count: (event.count ?? 1) + state.suppressed }
            : {}),
        });
        states.set(event.fingerprint, { sentAt: timestamp, suppressed: 0 });
      } catch (error) {
        onDeliveryError(error);
      }
    },
  };
}

export const defaultAlertDispatcher = createDeduplicatingDispatcher({
  send: createDiscordAlertSink({
    ...(appEnv.DISCORD_ALERT_WEBHOOK_URL
      ? { webhookUrl: appEnv.DISCORD_ALERT_WEBHOOK_URL }
      : {}),
    alertEnvironment: appEnv.ALERT_ENV,
  }),
});
