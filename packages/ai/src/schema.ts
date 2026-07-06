import { z } from "zod";
import type { CategorizeInput, CategorizeResult } from "./types";

export const categorizeResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("existing"),
    categoryId: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("new"),
    name: z.string().trim().min(1).max(10),
    confidence: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("none") }),
]);

export function parseCategorizeResponse(value: unknown): CategorizeResult {
  const parsed = categorizeResponseSchema.safeParse(value);
  if (!parsed.success) {
    console.warn("AI categorize response parse failed", parsed.error);
    return { type: "none" };
  }
  return parsed.data;
}

export const jsonSchema = {
  type: "object" as const,
  properties: {
    type: { type: "string" as const, enum: ["existing", "new", "none"] },
    categoryId: { type: "string" as const },
    name: { type: "string" as const },
    confidence: { type: "number" as const, minimum: 0, maximum: 1 },
  },
  required: ["type"],
  additionalProperties: false,
};

export function systemPrompt(): string {
  return [
    "너는 북마크 분류기다. 웹페이지 정보와 사용자의 기존 카테고리 목록을 보고 가장 적합한 카테고리를 고른다.",
    "규칙:",
    "1. 기존 카테고리 중 명확히 맞는 것이 있으면 반드시 그것을 선택한다 (id로).",
    "2. 기존 카테고리로 무리 없이 분류할 수 없을 때만 새 카테고리를 제안한다.",
    "3. 새 이름은 한국어, 1~10자, 일반적·재사용 가능한 수준으로 한다.",
    "4. 정보가 부족해 판단이 어려우면 none을 반환한다.",
    "5. confidence는 0~1이다.",
  ].join("\n");
}

export function userPrompt(input: CategorizeInput): string {
  return JSON.stringify(
    {
      url: input.url,
      title: input.title,
      description: input.description,
      siteName: input.siteName,
      existingCategories: input.existingCategories,
    },
    null,
    2,
  );
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
