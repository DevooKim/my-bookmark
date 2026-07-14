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

export interface PlaceCandidate {
  name: string;
  locality: string | null;
  confidence: number;
}

export const sourcePlatforms = [
  "youtube",
  "instagram",
  "threads",
  "x",
  "tiktok",
  "github",
] as const;

export type SourcePlatform = (typeof sourcePlatforms)[number];

export interface SourceCandidate {
  platform: SourcePlatform;
  handle: string | null;
  postUrl: string | null;
  repository: string | null;
  confidence: number;
}

export interface AnalyzeResult {
  category: CategorizeResult;
  summaryTitle: string;
  summary?: string | null | undefined;
  tags: string[];
  place?: PlaceCandidate | null | undefined;
  source?: SourceCandidate | null | undefined;
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
