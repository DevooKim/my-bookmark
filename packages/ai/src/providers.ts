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

// 설정 화면 표시와 실패 사용량 기록(어떤 모델에서 났는지 알 수 없는 실패)에 쓰는 라벨.
// 분석 호출은 preset을 쓰지 않는다. 실측(2026-11-15): `model: "@preset/my-bookmark"`나
// `@preset/` 접두어를 붙인 `preset` 필드는 첫 모델이 429를 내면 폴백하지 않고, 접두어 없는
// `preset` 값은 OpenRouter가 무시한다. 폴백은 요청의 `models` 배열로만 동작하므로
// preset이 담당하던 provider 제한과 temperature는 요청이 직접 명시한다.
export const PRESET_LABEL = "@preset/my-bookmark";

// temperature는 보내지 않는다. preset에는 0.1이 있었지만 openai/gpt-6-luna가 temperature를
// 지원하지 않아, `require_parameters: true`와 함께 보내면 luna가 라우팅 후보에서 빠져
// 폴백이 사라진다(실측 2026-11-15: luna 단독 + temperature → 404 "No endpoints found that can
// handle the requested parameters", Gemini 429 시 폴백 불가). preset의 web_fetch 툴도
// 크레딧 과금 가능성과 지연 때문에 넣지 않는다.
// BYOK 키를 등록한 업스트림만 허용하고 학습용 데이터 수집은 거부한다.
// preset을 쓰지 않으므로 요청이 직접 명시한다.
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
