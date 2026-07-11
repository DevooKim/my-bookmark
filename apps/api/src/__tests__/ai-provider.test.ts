import type { AiProvider, AiProviderConfig } from "@my-bookmark/ai";
import { describe, expect, it, vi } from "vitest";
import { createSecretCipher } from "../lib/secret-crypto";
import {
  type AiSettingsRepository,
  createAiSettingsService,
} from "../services/ai-provider";

const userId = "11111111-1111-4111-8111-111111111111";

type Row = Awaited<ReturnType<AiSettingsRepository["get"]>>;

class FakeRepository implements AiSettingsRepository {
  rows = new Map<string, NonNullable<Row>>();
  requestedUsers: string[] = [];

  async get(requestedUserId: string) {
    this.requestedUsers.push(requestedUserId);
    return this.rows.get(requestedUserId) ?? null;
  }

  async save(requestedUserId: string, row: Omit<NonNullable<Row>, "user_id">) {
    this.requestedUsers.push(requestedUserId);
    const saved = { user_id: requestedUserId, ...row };
    this.rows.set(requestedUserId, saved);
    return saved;
  }
}

function setup() {
  const repository = new FakeRepository();
  const provider = {
    name: "fake",
    categorize: vi.fn(),
    validateConnection: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiProvider;
  const providerFactory = vi.fn((_config: AiProviderConfig) => provider);
  const service = createAiSettingsService({
    repository,
    cipher: createSecretCipher(Buffer.alloc(32, 4)),
    providerFactory,
  });
  return { repository, provider, providerFactory, service };
}

describe("AI settings service", () => {
  it("returns an unconfigured Gemini default without exposing keys", async () => {
    const { repository, service } = setup();

    await expect(service.getStatus(userId)).resolves.toEqual({
      provider: "gemini",
      model: "gemini-flash-lite-latest",
      enabled: false,
      providers: {
        gemini: { configured: false },
        anthropic: { configured: false },
        openai: { configured: false },
      },
    });
    expect(repository.requestedUsers).toEqual([userId]);
  });

  it("encrypts provider keys and retains them across model updates", async () => {
    const { repository, service } = setup();

    await service.saveKey(userId, "gemini", "gemini-key");
    await service.saveKey(userId, "openai", "openai-key");
    expect(repository.rows.get(userId)).toMatchObject({
      provider: "gemini",
      model: "gemini-flash-lite-latest",
    });
    await service.selectModel(userId, {
      provider: "gemini",
      model: "gemini-flash-latest",
    });

    const row = repository.rows.get(userId);
    expect(row?.provider).toBe("gemini");
    expect(row?.model).toBe("gemini-flash-latest");
    expect(row?.gemini_api_key_encrypted).toMatch(/^v1:/);
    expect(row?.gemini_api_key_encrypted).not.toContain("gemini-key");
    expect(await service.getStatus(userId)).toMatchObject({
      provider: "gemini",
      model: "gemini-flash-latest",
      enabled: true,
      providers: {
        gemini: { configured: true },
        openai: { configured: true },
      },
    });
  });

  it("deletes one provider key and disables it when selected", async () => {
    const { repository, service } = setup();
    await service.saveKey(userId, "openai", "openai-key");
    await service.selectModel(userId, {
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const status = await service.deleteKey(userId, "openai");

    expect(repository.rows.get(userId)?.openai_api_key_encrypted).toBeNull();
    expect(status.enabled).toBe(false);
  });

  it("caches providers and invalidates the cache after settings changes", async () => {
    const { provider, providerFactory, service } = setup();
    await service.saveKey(userId, "anthropic", "key-one");
    await service.selectModel(userId, {
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });

    await expect(service.getProvider(userId)).resolves.toBe(provider);
    await expect(service.getProvider(userId)).resolves.toBe(provider);
    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(providerFactory).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "key-one",
      model: "claude-haiku-4-5",
    });

    await service.saveKey(userId, "anthropic", "key-two");
    await service.selectModel(userId, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    await service.getProvider(userId);
    expect(providerFactory).toHaveBeenCalledTimes(2);
    expect(providerFactory).toHaveBeenLastCalledWith({
      provider: "anthropic",
      apiKey: "key-two",
      model: "claude-sonnet-4-6",
    });
  });

  it("rejects selecting a model whose provider has no stored or submitted key", async () => {
    const { service } = setup();

    await expect(
      service.selectModel(userId, {
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("tests a configured provider without adding the temporary instance to cache", async () => {
    const { provider, providerFactory, service } = setup();
    await service.saveKey(userId, "openai", "openai-key");

    await expect(service.testConnection(userId, "openai")).resolves.toBe(true);
    expect(provider.validateConnection).toHaveBeenCalledOnce();
    expect(providerFactory).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "openai-key",
    });

    vi.mocked(provider.validateConnection).mockRejectedValueOnce(
      new Error("invalid key"),
    );
    await expect(service.testConnection(userId, "openai")).resolves.toBe(false);
  });
});
