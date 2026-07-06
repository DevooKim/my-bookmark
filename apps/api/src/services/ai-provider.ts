import { type AiProvider, createAiProvider } from "@my-bookmark/ai";
import { appEnv } from "../lib/env";

let provider: AiProvider | null | undefined;

export function getAiProvider(): AiProvider | null {
  if (provider !== undefined) {
    return provider;
  }

  const apiKey = selectedApiKey();
  if (!apiKey) {
    console.warn(
      `AI provider ${appEnv.AI_PROVIDER} is disabled: API key is not configured`,
    );
    provider = null;
    return provider;
  }

  provider = createAiProvider({
    provider: appEnv.AI_PROVIDER,
    apiKey,
    ...(appEnv.AI_MODEL ? { model: appEnv.AI_MODEL } : {}),
  });
  return provider;
}

export function getAiProviderLabel(): string {
  return appEnv.AI_PROVIDER;
}

function selectedApiKey(): string | undefined {
  if (appEnv.AI_PROVIDER === "anthropic") {
    return appEnv.ANTHROPIC_API_KEY;
  }
  if (appEnv.AI_PROVIDER === "openai") {
    return appEnv.OPENAI_API_KEY;
  }
  return appEnv.GEMINI_API_KEY;
}
