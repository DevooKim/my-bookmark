import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  categorizeResponseSchema,
  jsonSchema,
  parseCategorizeResponse,
  systemPrompt,
  userPrompt,
  withTimeout,
} from "./schema";
import type {
  AiProvider,
  AiProviderConfig,
  CategorizeInput,
  CategorizeResult,
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

  async categorize(input: CategorizeInput): Promise<CategorizeResult> {
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
              type: { type: Type.STRING, enum: ["existing", "new", "none"] },
              categoryId: { type: Type.STRING },
              name: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
            required: ["type"],
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

  async categorize(input: CategorizeInput): Promise<CategorizeResult> {
    return withTimeout(async (signal) => {
      const message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 512,
          system: systemPrompt(),
          messages: [{ role: "user", content: userPrompt(input) }],
          tools: [
            {
              name: "categorize_bookmark",
              description: "Return the bookmark category decision.",
              input_schema: jsonSchema,
            },
          ],
          tool_choice: { type: "tool", name: "categorize_bookmark" },
        },
        { signal },
      );
      const toolUse = message.content.find((part) => part.type === "tool_use");
      return parseCategorizeResponse(toolUse?.input ?? { type: "none" });
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

  async categorize(input: CategorizeInput): Promise<CategorizeResult> {
    return withTimeout(async (signal) => {
      const response = await this.client.responses.parse(
        {
          model: this.model,
          instructions: systemPrompt(),
          input: userPrompt(input),
          text: {
            format: zodTextFormat(
              categorizeResponseSchema,
              "bookmark_category",
            ),
          },
        },
        { signal },
      );
      return parseCategorizeResponse(
        response.output_parsed ?? { type: "none" },
      );
    });
  }
}

function parseJsonText(text: string): CategorizeResult {
  try {
    return parseCategorizeResponse(JSON.parse(text));
  } catch (error) {
    console.warn("AI JSON parse failed", error);
    return { type: "none" };
  }
}
