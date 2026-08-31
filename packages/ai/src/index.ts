// Embedding and categorization providers intentionally have separate contracts.
// Keep the embedding factory explicit in this workspace source barrel.
import { createEmbeddingProvider as createEmbeddingProviderImpl } from "./providers";

export {
  createAiProvider,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  PRESET_MODEL,
} from "./providers";

export const createEmbeddingProvider: (
  config: import("./types").EmbeddingProviderConfig,
) => import("./types").EmbeddingProvider = createEmbeddingProviderImpl;

export {
  categorizeResponseSchema,
  openRouterEmbeddingSchema,
  parseCategorizeResponse,
} from "./schema";
export type {
  AiProvider,
  AiProviderConfig,
  AnalyzeOutcome,
  AnalyzeResult,
  CategorizeInput,
  CategorizeResult,
  EmbeddingInput,
  EmbeddingProviderConfig,
  SourceCandidate,
  SourcePlatform,
} from "./types";
export type EmbeddingProvider = import("./types").EmbeddingProvider;
