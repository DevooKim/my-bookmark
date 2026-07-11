import { z } from "zod";
import type { AnalyzeResult, CategorizeInput, CategorizeResult } from "./types";

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

export const analyzeResponseSchema = z.object({
  category: categorizeResponseSchema,
  summaryTitle: z.string().trim().min(1).max(40),
  tags: z
    .array(z.string().trim().min(1).max(20))
    .min(3)
    .max(5)
    .refine((tags) => new Set(tags).size === tags.length),
});

export function parseAnalyzeResponse(value: unknown): AnalyzeResult | null {
  const parsed = analyzeResponseSchema.safeParse(value);
  if (!parsed.success) {
    console.warn("AI analysis response parse failed", parsed.error);
    return null;
  }
  return parsed.data;
}

const categoryJsonSchema = {
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

export const jsonSchema = {
  type: "object" as const,
  properties: {
    category: categoryJsonSchema,
    summaryTitle: { type: "string" as const, minLength: 1, maxLength: 40 },
    tags: {
      type: "array" as const,
      items: { type: "string" as const, minLength: 1, maxLength: 20 },
      minItems: 3,
      maxItems: 5,
      uniqueItems: true,
    },
  },
  required: ["category", "summaryTitle", "tags"],
  additionalProperties: false,
};

export function systemPrompt(): string {
  return [
    "너는 북마크 분류기다. 웹페이지 정보와 사용자의 기존 카테고리 목록을 보고 가장 적합한 카테고리를 고른다.",
    "규칙:",
    "1. 기존 카테고리 중 명확히 맞는 것이 있으면 반드시 그것을 선택한다 (id로).",
    "2. 기존 카테고리로 무리 없이 분류할 수 없을 때만 새 카테고리를 제안한다.",
    "3. 새 이름은 한국어, 1~10자, 일반적·재사용 가능한 수준으로 한다.",
    "4. 정보가 부족해 판단이 어려우면 category에 none을 반환한다.",
    "5. confidence는 0~1이다.",
    "6. summaryTitle은 원문을 핵심만 요약한 한국어 제목 스타일로 작성하며 최대 40자다.",
    "7. tags는 중복 없는 한국어 태그 3~5개로 작성하며 각 태그는 최대 20자다. 고유 기술명은 원문을 허용한다.",
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
