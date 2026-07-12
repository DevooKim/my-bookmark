import {
  type AiProvider,
  createAiProvider,
  PRESET_MODEL,
} from "@my-bookmark/ai";
import { appEnv } from "../lib/env";

const provider: AiProvider | null = appEnv.OPEN_ROUTER_API_KEY
  ? createAiProvider({ apiKey: appEnv.OPEN_ROUTER_API_KEY })
  : null;

if (!provider) {
  console.warn(
    "OPEN_ROUTER_API_KEY is not set — AI categorization is disabled",
  );
}

export function getAiProvider(): AiProvider | null {
  return provider;
}

export function getAiStatus(): { enabled: boolean; preset: string } {
  return { enabled: provider !== null, preset: PRESET_MODEL };
}

export async function testAiConnection(): Promise<boolean> {
  if (!provider) {
    return false;
  }
  try {
    await provider.validateConnection();
    return true;
  } catch (error) {
    console.warn("OpenRouter connection test failed", error);
    return false;
  }
}
