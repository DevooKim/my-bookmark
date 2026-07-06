export interface ClassifyInput {
  url: string;
  title?: string;
  description?: string;
  categoryNames?: readonly string[];
}

export interface ClassifyResult {
  categoryName: string;
  confidence: number;
}

export interface AiProvider {
  classify(input: ClassifyInput): Promise<ClassifyResult>;
}
