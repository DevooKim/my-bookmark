interface CategoryInput {
  id: string;
  name: string;
}

interface BaseCategorizeInput {
  existingCategories: CategoryInput[];
}

export type CategorizeInput =
  | (BaseCategorizeInput & {
      kind: "link";
      url: string;
      title?: string;
      description?: string;
      siteName?: string;
    })
  | (BaseCategorizeInput & {
      kind: "image";
      image: {
        mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
        base64: string;
      };
    });

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
