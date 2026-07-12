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
  summary?: string | null | undefined;
  tags: string[];
}

export interface AiProviderConfig {
  apiKey: string;
}

export interface AnalyzeOutcome {
  analysis: AnalyzeResult;
  model: string;
  isByok: boolean | null;
}

export interface AiProvider {
  categorize(input: CategorizeInput): Promise<AnalyzeOutcome>;
  validateConnection(): Promise<void>;
}
