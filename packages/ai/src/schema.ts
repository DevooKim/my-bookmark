import { z } from "zod";
import type { AnalyzeResult, CategorizeInput, CategorizeResult } from "./types";
import { sourcePlatforms } from "./types";

export const categorizeResponseSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("existing"),
    categoryId: z.string().min(1),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .nullish()
      .transform((value) => value ?? 0),
  }),
  z.object({
    type: z.literal("new"),
    name: z.string().trim().min(1).max(16),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .nullish()
      .transform((value) => value ?? 0),
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
  summary: z.string().trim().min(1).max(300).nullish(),
  tags: z
    .array(z.string().trim().min(1).max(20))
    .min(3)
    .max(5)
    .refine((tags) => new Set(tags).size === tags.length),
  place: z
    .object({
      name: z.string().trim().min(1).max(120),
      locality: z.string().trim().min(1).max(120).nullable(),
      confidence: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
  source: z
    .object({
      platform: z.enum(sourcePlatforms),
      handle: z.string().trim().min(1).max(100).nullable(),
      postUrl: z.string().trim().min(1).max(2048).nullable(),
      repository: z.string().trim().min(1).max(201).nullable(),
      confidence: z.number().min(0).max(1),
    })
    .nullable()
    .optional(),
});

export function parseAnalyzeResponse(value: unknown): AnalyzeResult | null {
  const parsed = analyzeResponseSchema.safeParse(value);
  if (!parsed.success) {
    console.warn("AI analysis response parse failed", parsed.error);
    return null;
  }
  return parsed.data;
}

// strict json_schema 규칙(실측 2026-07-12): OpenAI 계열 업스트림은 strict 모드에서
// 모든 property가 required여야 한다. 조건부 필드(categoryId/name/confidence)는
// nullable(type 배열에 "null" 포함)로 선언하고 전부 required에 넣는다.
export const jsonSchema = {
  type: "object" as const,
  properties: {
    category: {
      type: "object" as const,
      properties: {
        type: { type: "string" as const, enum: ["existing", "new", "none"] },
        categoryId: { type: ["string", "null"] as const },
        name: { type: ["string", "null"] as const },
        confidence: { type: ["number", "null"] as const },
      },
      required: ["type", "categoryId", "name", "confidence"],
      additionalProperties: false,
    },
    summaryTitle: { type: "string" as const },
    summary: { type: "string" as const },
    tags: { type: "array" as const, items: { type: "string" as const } },
    place: {
      type: ["object", "null"] as const,
      properties: {
        name: { type: "string" as const },
        locality: { type: ["string", "null"] as const },
        confidence: { type: "number" as const, minimum: 0, maximum: 1 },
      },
      required: ["name", "locality", "confidence"],
      additionalProperties: false,
    },
    source: {
      type: ["object", "null"] as const,
      properties: {
        platform: { type: "string" as const, enum: sourcePlatforms },
        handle: { type: ["string", "null"] as const },
        postUrl: { type: ["string", "null"] as const },
        repository: { type: ["string", "null"] as const },
        confidence: { type: "number" as const, minimum: 0, maximum: 1 },
      },
      required: ["platform", "handle", "postUrl", "repository", "confidence"],
      additionalProperties: false,
    },
  },
  required: ["category", "summaryTitle", "summary", "tags", "place", "source"],
  additionalProperties: false,
};

// OpenRouter chat/completions 응답 경계 스키마.
export const openRouterCompletionSchema = z.object({
  model: z.string().default(""),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  usage: z.object({ is_byok: z.boolean().nullish() }).nullish(),
});

export function systemPrompt(): string {
  return [
    "너는 저장 자료 분류기다. 링크 또는 이미지와 사용자의 기존 카테고리 목록을 보고 가장 적합한 카테고리를 고른다.",
    "규칙:",
    "1. 기존 카테고리 중 명확히 맞는 것이 있으면 반드시 그것을 선택한다 (id로).",
    "2. 기존 카테고리로 무리 없이 분류할 수 없을 때만 새 카테고리를 제안한다.",
    "3. 새 카테고리 이름은 '이모지 1개 + 공백 + 한국어 이름(1~10자)' 형식의 한 문자열로 만든다. 예: '💻 개발', '📰 뉴스', '🎨 디자인'. 이모지는 주제를 대표하는 것 1개만 앞에 붙이고, 이름은 일반적·재사용 가능한 수준으로 한다.",
    "4. 정보가 부족해 판단이 어려우면 category에 none을 반환한다.",
    "5. confidence는 0~1이다.",
    "6. summaryTitle은 원문을 핵심만 요약한 한국어 제목 스타일로 작성하며 최대 40자다.",
    "7. tags는 중복 없는 한국어 태그 3~5개로 작성하며 각 태그는 최대 20자다. 고유 기술명은 원문을 허용한다.",
    "8. summary는 원문의 핵심을 한국어 1~3문장으로 요약한다. 불필요한 수식 없이 정보만 담고, 전체 300자 이내로 한다.",
    "9. 해당 없는 필드(categoryId, name)는 null로 채운다.",
    "10. 식당·카페·주점 등 방문 가능한 음식점의 상호가 본문이나 이미지에 직접 확인될 때만 place를 반환한다.",
    "11. 음식 사진만으로 상호를 추측하지 않는다. 상호가 불명확하거나 여러 장소가 섞이면 place는 null이다.",
    "12. 지점명은 place.name에 포함하고 확인 가능한 동네·도시·주소 단서는 place.locality에 넣는다.",
    "13. YouTube, Instagram, Threads, X, TikTok, GitHub의 handle, 게시물 URL·ID, GitHub owner/repository가 이미지에 직접 보일 때만 source를 반환한다.",
    "14. 표시명이나 로고만으로 계정을 추측하지 않는다. 직접 확인할 수 없으면 source는 null이다.",
    "15. source.postUrl은 게시물 URL이나 ID가 직접 보일 때만 넣고, GitHub 저장소는 source.repository에 owner/repository로 넣는다.",
  ].join("\n");
}

export function userPrompt(input: CategorizeInput): string {
  if (input.kind === "image") {
    return JSON.stringify(
      {
        contentType: "image",
        instruction:
          "첨부 이미지를 분석해 핵심을 설명하는 한국어 제목, 요약, 태그, 카테고리를 생성한다. OCR 원문 전체를 옮기지 않는다.",
        existingCategories: input.existingCategories,
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      contentType: "link",
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
