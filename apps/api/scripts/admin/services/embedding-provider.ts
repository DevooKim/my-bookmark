import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "@my-bookmark/ai";
import { appEnv } from "../lib/env";

const provider: EmbeddingProvider | null = appEnv.OPEN_ROUTER_API_KEY
  ? createEmbeddingProvider({ apiKey: appEnv.OPEN_ROUTER_API_KEY })
  : null;

if (!provider) {
  console.warn(
    "OPEN_ROUTER_API_KEY is not set — bookmark embeddings are disabled",
  );
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  return provider;
}
