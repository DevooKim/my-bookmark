import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  analyzeResponseSchema,
  jsonSchema,
  parseAnalyzeResponse,
  systemPrompt,
  userPrompt,
  withTimeout,
} from "./schema";
import type {
  AiProvider,
  AiProviderConfig,
  AnalyzeResult,
  CategorizeInput,
} from "./types";

export const DEFAULT_MODELS = {
  // rolling alias: google retired gemini-2.5-flash for generateContent
  // (404 as of 2026-07). lite tier suits single-label classification and
  // answers well under the 15s abort budget.
  gemini: "gemini-flash-lite-latest",
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
} as const;

export function createAiProvider(config: AiProviderConfig): AiProvider {
  if (config.provider === "gemini") {
    return new GeminiProvider(
      config.apiKey,
      config.model ?? DEFAULT_MODELS.gemini,
    );
  }
  if (config.provider === "anthropic") {
    return new AnthropicProvider(
      config.apiKey,
      config.model ?? DEFAULT_MODELS.anthropic,
    );
  }
  return new OpenAiProvider(
    config.apiKey,
    config.model ?? DEFAULT_MODELS.openai,
  );
}

class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async validateConnection(): Promise<void> {
    await withTimeout(
      (signal) =>
        this.client.models.list({
          config: { pageSize: 1, abortSignal: signal },
        }),
      10_000,
    );
  }

  async categorize(input: CategorizeInput): Promise<AnalyzeResult> {
    return withTimeout(async (signal) => {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: userPrompt(input) }] }],
        config: {
          systemInstruction: systemPrompt(),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    enum: ["existing", "new", "none"],
                  },
                  categoryId: { type: Type.STRING },
                  name: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
                required: ["type"],
              },
              summaryTitle: { type: Type.STRING },
              summary: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["category", "summaryTitle", "summary", "tags"],
          },
          abortSignal: signal,
        },
      });
      return parseJsonText(response.text ?? "{}");
    });
  }
}

class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async validateConnection(): Promise<void> {
    await withTimeout(
      (signal) => this.client.models.list({ limit: 1 }, { signal }),
      10_000,
    );
  }

  async categorize(input: CategorizeInput): Promise<AnalyzeResult> {
    return withTimeout(async (signal) => {
      const message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 512,
          system: systemPrompt(),
          messages: [{ role: "user", content: userPrompt(input) }],
          tools: [
            {
              name: "analyze_bookmark",
              description:
                "Return the bookmark category, summary title, and tags.",
              input_schema: jsonSchema,
            },
          ],
          tool_choice: { type: "tool", name: "analyze_bookmark" },
        },
        { signal },
      );
      const toolUse = message.content.find((part) => part.type === "tool_use");
      return requireAnalyzeResponse(toolUse?.input);
    });
  }
}

class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async validateConnection(): Promise<void> {
    await withTimeout((signal) => this.client.models.list({ signal }), 10_000);
  }

  async categorize(input: CategorizeInput): Promise<AnalyzeResult> {
    return withTimeout(async (signal) => {
      const response = await this.client.responses.parse(
        {
          model: this.model,
          instructions: systemPrompt(),
          input: userPrompt(input),
          text: {
            format: zodTextFormat(analyzeResponseSchema, "bookmark_analysis"),
          },
        },
        { signal },
      );
      return requireAnalyzeResponse(response.output_parsed);
    });
  }
}

function parseJsonText(text: string): AnalyzeResult {
  try {
    return requireAnalyzeResponse(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn("AI JSON parse failed", error);
      throw new Error("AI analysis response is malformed", { cause: error });
    }
    throw error;
  }
}

function requireAnalyzeResponse(value: unknown): AnalyzeResult {
  const result = parseAnalyzeResponse(value);
  if (!result) {
    throw new Error("AI analysis response is malformed");
  }
  return result;
}
