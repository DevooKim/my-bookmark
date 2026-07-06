export interface CategorizeInput {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  existingCategories: { id: string; name: string }[];
}

export type CategorizeResult =
  | { type: "existing"; categoryId: string; confidence: number }
  | { type: "new"; name: string; confidence: number }
  | { type: "none" };

export interface AiProvider {
  readonly name: string;
  categorize(input: CategorizeInput): Promise<CategorizeResult>;
}

export type AiProviderName = "gemini" | "anthropic" | "openai";

export interface AiProviderConfig {
  provider: AiProviderName;
  apiKey: string;
  model?: string;
}
