import {
  jsonSchema,
  openRouterCompletionSchema,
  parseAnalyzeResponse,
  systemPrompt,
  userPrompt,
  withTimeout,
} from "./schema";
import type {
  AiProvider,
  AiProviderConfig,
  AnalyzeOutcome,
  CategorizeInput,
} from "./types";

export const PRESET_MODEL = "@preset/my-bookmark";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface HttpError extends Error {
  status: number;
}

function httpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

export function createAiProvider(config: AiProviderConfig): AiProvider {
  return new OpenRouterProvider(config.apiKey);
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
        json = JSON.parse(content);
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
    });
  }
}
