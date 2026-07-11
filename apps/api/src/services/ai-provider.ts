import {
  type AiProvider,
  type AiProviderConfig,
  createAiProvider,
} from "@my-bookmark/ai";
import {
  type AiModelId,
  type AiProviderName,
  type AiStatusResponse,
  API_ERROR_CODES,
  aiModelIdSchema,
  aiProviderNameSchema,
  type UpdateAiSettingsRequest,
} from "@my-bookmark/shared";
import { z } from "zod";
import { appEnv } from "../lib/env";
import {
  createSecretCipher,
  parseEncryptionKey,
  type SecretCipher,
} from "../lib/secret-crypto";
import { supabaseAdmin } from "../lib/supabase";
import { HttpError } from "../middleware/error";

const aiSettingsRowSchema = z.object({
  user_id: z.string().uuid(),
  provider: aiProviderNameSchema,
  model: aiModelIdSchema,
  gemini_api_key_encrypted: z.string().nullable(),
  anthropic_api_key_encrypted: z.string().nullable(),
  openai_api_key_encrypted: z.string().nullable(),
});

export type AiSettingsRow = z.infer<typeof aiSettingsRowSchema>;
type AiSettingsValues = Omit<AiSettingsRow, "user_id">;

export interface AiSettingsRepository {
  get(userId: string): Promise<AiSettingsRow | null>;
  save(userId: string, values: AiSettingsValues): Promise<AiSettingsRow>;
}

export interface AiSettingsService {
  getStatus(userId: string): Promise<AiStatusResponse>;
  save(
    userId: string,
    input: UpdateAiSettingsRequest,
  ): Promise<AiStatusResponse>;
  deleteKey(
    userId: string,
    provider: AiProviderName,
  ): Promise<AiStatusResponse>;
  getProvider(userId: string): Promise<AiProvider | null>;
  testConnection(userId: string, provider: AiProviderName): Promise<boolean>;
  invalidate(userId: string): void;
}

interface AiSettingsServiceOptions {
  repository: AiSettingsRepository;
  cipher: SecretCipher;
  providerFactory?: (config: AiProviderConfig) => AiProvider;
}

const emptyValues: AiSettingsValues = {
  provider: "gemini",
  model: "gemini-flash-lite-latest",
  gemini_api_key_encrypted: null,
  anthropic_api_key_encrypted: null,
  openai_api_key_encrypted: null,
};

const defaultModels = {
  gemini: "gemini-flash-lite-latest",
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
} as const satisfies Record<AiProviderName, AiModelId>;

const keyColumns = {
  gemini: "gemini_api_key_encrypted",
  anthropic: "anthropic_api_key_encrypted",
  openai: "openai_api_key_encrypted",
} as const satisfies Record<AiProviderName, keyof AiSettingsValues>;

export function createAiSettingsService({
  repository,
  cipher,
  providerFactory = createAiProvider,
}: AiSettingsServiceOptions): AiSettingsService {
  const providerCache = new Map<string, AiProvider | null>();

  async function loadValues(userId: string): Promise<AiSettingsValues> {
    const row = await repository.get(userId);
    if (!row) {
      return { ...emptyValues };
    }
    const { user_id: _userId, ...values } = row;
    return values;
  }

  function toStatus(values: AiSettingsValues): AiStatusResponse {
    const configured = {
      gemini: values.gemini_api_key_encrypted !== null,
      anthropic: values.anthropic_api_key_encrypted !== null,
      openai: values.openai_api_key_encrypted !== null,
    };
    return {
      provider: values.provider,
      model: values.model,
      enabled: configured[values.provider],
      providers: {
        gemini: { configured: configured.gemini },
        anthropic: { configured: configured.anthropic },
        openai: { configured: configured.openai },
      },
    };
  }

  return {
    async getStatus(userId) {
      return toStatus(await loadValues(userId));
    },
    async save(userId, input) {
      const values = await loadValues(userId);
      values.provider = input.provider;
      values.model = input.model;
      if (input.apiKey !== undefined) {
        values[keyColumns[input.provider]] = cipher.encrypt(input.apiKey);
      }
      if (!values[keyColumns[input.provider]]) {
        throw new HttpError(
          400,
          API_ERROR_CODES.VALIDATION_ERROR,
          "Selected provider requires an API key",
        );
      }
      const saved = await repository.save(userId, values);
      providerCache.delete(userId);
      const { user_id: _userId, ...savedValues } = saved;
      return toStatus(savedValues);
    },
    async deleteKey(userId, provider) {
      const values = await loadValues(userId);
      values[keyColumns[provider]] = null;
      const saved = await repository.save(userId, values);
      providerCache.delete(userId);
      const { user_id: _userId, ...savedValues } = saved;
      return toStatus(savedValues);
    },
    async getProvider(userId) {
      if (providerCache.has(userId)) {
        return providerCache.get(userId) ?? null;
      }
      const values = await loadValues(userId);
      const encryptedKey = values[keyColumns[values.provider]];
      const provider = encryptedKey
        ? providerFactory({
            provider: values.provider,
            model: values.model,
            apiKey: cipher.decrypt(encryptedKey),
          })
        : null;
      providerCache.set(userId, provider);
      return provider;
    },
    async testConnection(userId, provider) {
      const values = await loadValues(userId);
      const encryptedKey = values[keyColumns[provider]];
      if (!encryptedKey) {
        throw new HttpError(
          400,
          API_ERROR_CODES.VALIDATION_ERROR,
          "Provider requires an API key",
        );
      }
      try {
        const instance = providerFactory({
          provider,
          model:
            values.provider === provider
              ? values.model
              : defaultModels[provider],
          apiKey: cipher.decrypt(encryptedKey),
        });
        await instance.validateConnection();
        return true;
      } catch (error) {
        console.warn(`AI provider ${provider} connection test failed`, error);
        return false;
      }
    },
    invalidate(userId) {
      providerCache.delete(userId);
    },
  };
}

function createSupabaseAiSettingsRepository(): AiSettingsRepository {
  function getDb() {
    if (!supabaseAdmin) {
      throw new Error("Database is not configured");
    }
    return supabaseAdmin;
  }

  return {
    async get(userId) {
      const { data, error } = await getDb()
        .from("ai_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data ? aiSettingsRowSchema.parse(data) : null;
    },
    async save(userId, values) {
      const { data, error } = await getDb()
        .from("ai_settings")
        .upsert({ user_id: userId, ...values }, { onConflict: "user_id" })
        .select("*")
        .single();
      if (error) {
        throw error;
      }
      return aiSettingsRowSchema.parse(data);
    },
  };
}

const testKey = Buffer.alloc(32).toString("base64");
const encryptionKey = parseEncryptionKey(
  appEnv.AI_SETTINGS_ENCRYPTION_KEY ?? testKey,
);

export const aiSettingsService = createAiSettingsService({
  repository: createSupabaseAiSettingsRepository(),
  cipher: createSecretCipher(encryptionKey),
});

export function getAiProvider(userId: string): Promise<AiProvider | null> {
  return aiSettingsService.getProvider(userId);
}
