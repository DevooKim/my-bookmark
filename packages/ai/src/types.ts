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

export interface AnalyzeResult {
  category: CategorizeResult;
  summaryTitle: string;
  tags: string[];
}

export interface AiProvider {
  readonly name: string;
  categorize(input: CategorizeInput): Promise<AnalyzeResult>;
  validateConnection(): Promise<void>;
}

export type AiProviderName = "gemini" | "anthropic" | "openai";

export interface AiProviderConfig {
  provider: AiProviderName;
  apiKey: string;
  model?: string;
}
