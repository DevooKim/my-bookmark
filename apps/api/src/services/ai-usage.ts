import {
  type AiAccountUsageResponse,
  type AiUsageEvent,
  API_ERROR_CODES,
  aiAccountUsageResponseSchema,
  aiUsageEventSchema,
} from "@my-bookmark/shared";
import { z } from "zod";
import { HttpError } from "../middleware/error";
import type { AiUsageEventInput } from "./categorize";

interface UsageInsertDb {
  from(table: "ai_usage_events"): {
    insert(values: Record<string, unknown>): PromiseLike<{
      error: { message?: string } | null;
    }>;
  };
}

interface UsageRow {
  id: string;
  provider: string;
  model: string;
  bookmark_id: string | null;
  status: "success" | "failed";
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface UsageSelectDb {
  from(table: "ai_usage_events"): {
    select(columns: string): {
      eq(
        field: string,
        value: string,
      ): {
        gte(
          field: string,
          value: string,
        ): {
          order(
            field: string,
            options: { ascending: boolean },
          ): {
            limit(count: number): PromiseLike<{
              data: UsageRow[] | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
}

// 기록 실패는 분류를 깨면 안 된다 — 절대 throw하지 않는다.
export function createAiUsageRecorder(db: unknown, userId: string) {
  return async (event: AiUsageEventInput): Promise<void> => {
    try {
      const { error } = await (db as UsageInsertDb)
        .from("ai_usage_events")
        .insert({
          user_id: userId,
          provider: event.provider,
          model: event.model,
          bookmark_id: event.bookmarkId,
          status: event.status,
          error_code: event.errorCode,
          duration_ms: event.durationMs,
        });
      if (error) {
        throw error;
      }
    } catch (error) {
      console.warn("AI usage event insert failed", error);
    }
  };
}

export async function listAiUsageEvents(
  db: unknown,
  userId: string,
  days: number,
): Promise<AiUsageEvent[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { data, error } = await (db as UsageSelectDb)
    .from("ai_usage_events")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) =>
    aiUsageEventSchema.parse({
      id: row.id,
      provider: row.provider,
      model: row.model,
      bookmarkId: row.bookmark_id,
      status: row.status,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    }),
  );
}

const openRouterKeyResponseSchema = z.object({
  data: z.object({
    usage: z.number(),
    usage_daily: z.number(),
    usage_weekly: z.number(),
    usage_monthly: z.number(),
    limit: z.number().nullable(),
    limit_remaining: z.number().nullable(),
    is_free_tier: z.boolean(),
  }),
});

export async function fetchAccountUsage(
  apiKey: string,
): Promise<AiAccountUsageResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new HttpError(
      502,
      API_ERROR_CODES.INTERNAL,
      "OpenRouter key lookup failed",
    );
  }
  const parsed = openRouterKeyResponseSchema.parse(await response.json());
  return aiAccountUsageResponseSchema.parse({
    usage: parsed.data.usage,
    usageDaily: parsed.data.usage_daily,
    usageWeekly: parsed.data.usage_weekly,
    usageMonthly: parsed.data.usage_monthly,
    limit: parsed.data.limit,
    limitRemaining: parsed.data.limit_remaining,
    isFreeTier: parsed.data.is_free_tier,
  });
}
