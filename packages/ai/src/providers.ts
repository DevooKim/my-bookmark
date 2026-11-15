import {
  jsonSchema,
  openRouterCompletionSchema,
  openRouterEmbeddingSchema,
  parseAnalyzeResponse,
  systemPrompt,
  unwrapJsonContent,
  userPrompt,
  withTimeout,
} from "./schema";
import type {
  AiProvider,
  AiProviderConfig,
  AnalyzeOutcome,
  CategorizeInput,
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from "./types";

// 요청 본문의 `preset` 필드 값과 화면·사용량 기록에 쓰는 표시 라벨.
// 실측(2026-11-15): `@preset/` 접두어 없는 slug는 OpenRouter가 무시하고(문서에도 명시),
// 접두어를 붙이면 preset이 적용되지만 그 경우 요청의 `models`가 폴백으로 동작하지 않고
// 첫 모델의 429가 그대로 반환된다. 그래서 폴백이 되는 이 형태(접두어 없는 slug + models)를 쓰며,
// preset의 provider 설정은 적용되지 않으므로 요청이 provider 제한을 직접 명시한다.
export const PRESET_NAME = "my-bookmark";
export const PRESET_LABEL = `@preset/${PRESET_NAME}`;

// BYOK 키를 등록한 업스트림만 허용하고 학습용 데이터 수집은 거부한다.
// 요청의 `provider` 객체는 preset의 provider 설정을 통째로 대체하므로 여기서 명시한다.
export const ALLOWED_PROVIDERS: readonly string[] = [
  "google-ai-studio",
  "openai",
];

export const DEFAULT_MODELS: readonly string[] = [
  "google/gemini-3.5-flash-lite",
  "openai/gpt-6-luna",
];

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// 실측 BYOK Gemini 분석 호출이 6~24초라 기본 15초로는 AbortError가 잦았다.
export const CATEGORIZE_TIMEOUT_MS = 60_000;

export interface HttpError extends Error {
  status: number;
}

function httpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export function createAiProvider(config: AiProviderConfig): AiProvider {
  return new OpenRouterProvider(config.apiKey, config.models ?? DEFAULT_MODELS);
}

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  return new OpenRouterEmbeddingProvider(config.apiKey);
}

class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string) {}

  async embed(input: { text: string }): Promise<number[]>;
  async embed(input: { text: string[] }): Promise<number[][]>;
  async embed(input: { text: string | string[] }) {
    const isBatch = Array.isArray(input.text);
    if (isBatch && input.text.length === 0) {
      return [];
    }
    const texts: string[] =
      typeof input.text === "string" ? [input.text] : input.text;
    const response = await withTimeout(async (signal) => {
      const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "my-bookmark",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: isBatch ? texts : texts[0],
          encoding_format: "float",
        }),
        signal,
      });
      if (!response.ok) {
        throw httpError(
          response.status,
          `OpenRouter embedding request failed with status ${response.status}`,
        );
      }
      return openRouterEmbeddingSchema.parse(await response.json());
    });

    const byIndex = new Map(
      response.data.map((item) => [item.index, item.embedding]),
    );
    if (
      byIndex.size !== texts.length ||
      response.data.some((item) => item.index >= texts.length)
    ) {
      throw new Error("OpenRouter embedding response indexes are malformed");
    }
    const ordered = texts.map((_text, index) => {
      const embedding = byIndex.get(index);
      if (!embedding) {
        throw new Error("OpenRouter embedding response is missing an item");
      }
      return embedding;
    });

    const first = ordered[0];
    if (!first) {
      throw new Error("OpenRouter embedding response is empty");
    }
    return isBatch ? ordered : first;
  }
}

class OpenRouterProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly models: readonly string[],
  ) {
    if (models.length === 0) {
      throw new Error("At least one OpenRouter model is required");
    }
  }

  async validateConnection(): Promise<void> {
    await withTimeout(async (signal) => {
      const response = await fetch(`${OPENROUTER_BASE_URL}/key`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      });
      if (!response.ok) {
        throw httpError(
          response.status,
          `OpenRouter key validation failed with status ${response.status}`,
        );
      }
    }, 10_000);
  }

  async categorize(input: CategorizeInput): Promise<AnalyzeOutcome> {
    return withTimeout(async (signal) => {
      const prompt = userPrompt(input);
      const userContent =
        input.kind === "image"
          ? [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${input.image.mimeType};base64,${input.image.base64}`,
                },
              },
            ]
          : prompt;
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "my-bookmark",
        },
        body: JSON.stringify({
          preset: PRESET_NAME,
          models: this.models,
          max_tokens: 2048,
          provider: {
            require_parameters: true,
            only: ALLOWED_PROVIDERS,
            data_collection: "deny",
          },
          messages: [
            { role: "system", content: systemPrompt() },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "bookmark_analysis",
              strict: true,
              schema: jsonSchema,
            },
          },
        }),
        signal,
      });

      if (!response.ok) {
        throw httpError(
          response.status,
          `OpenRouter chat completion failed with status ${response.status}`,
        );
      }

      const parsed = openRouterCompletionSchema.parse(await response.json());
      const content = parsed.choices[0]?.message.content ?? null;
      if (content === null) {
        throw new Error("AI analysis response is malformed");
      }

      let json: unknown;
      try {
        json = JSON.parse(unwrapJsonContent(content));
      } catch (error) {
        if (error instanceof SyntaxError) {
          console.warn("AI JSON parse failed", error);
          throw new Error("AI analysis response is malformed", {
            cause: error,
          });
        }
        throw error;
      }

      const analysis = parseAnalyzeResponse(json);
      if (!analysis) {
        throw new Error("AI analysis response is malformed");
      }

      return {
        analysis,
        model: parsed.model || PRESET_LABEL,
        isByok: parsed.usage?.is_byok ?? null,
      };
    }, CATEGORIZE_TIMEOUT_MS);
  }
}
