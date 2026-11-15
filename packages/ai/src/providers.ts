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

export const PRESET_MODEL = "@preset/my-bookmark";

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
  return new OpenRouterProvider(config.apiKey);
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
  constructor(private readonly apiKey: string) {}

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
          model: PRESET_MODEL,
          max_tokens: 2048,
          provider: { require_parameters: true },
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
        model: parsed.model || PRESET_MODEL,
        isByok: parsed.usage?.is_byok ?? null,
      };
    }, CATEGORIZE_TIMEOUT_MS);
  }
}
