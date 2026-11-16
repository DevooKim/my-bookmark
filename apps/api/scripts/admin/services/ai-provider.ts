import { type AiProvider, createAiProvider } from "@my-bookmark/ai";
import { appEnv } from "../lib/env";

const provider: AiProvider | null = appEnv.OPEN_ROUTER_API_KEY
  ? createAiProvider({
      apiKey: appEnv.OPEN_ROUTER_API_KEY,
      models: appEnv.OPEN_ROUTER_MODELS,
    })
  : null;

if (!provider) {
  console.warn(
    "OPEN_ROUTER_API_KEY is not set — AI categorization is disabled",
  );
}

export function getAiProvider(): AiProvider | null {
  return provider;
}
