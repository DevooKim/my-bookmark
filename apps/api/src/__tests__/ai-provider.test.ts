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
      modelOrder: [],
      providers: {
        gemini: { configured: false },
        anthropic: { configured: false },
        openai: { configured: false },
      },
    });
    expect(repository.requestedUsers).toEqual([userId]);
  });

  it("encrypts provider keys and retains them across model reorders", async () => {
    const { repository, service } = setup();

    await service.saveKey(userId, "gemini", "gemini-key");
    await service.saveKey(userId, "openai", "openai-key");
    expect(repository.rows.get(userId)).toMatchObject({
      provider: "gemini",
      model: "gemini-flash-lite-latest",
    });
    await service.reorderModels(userId, {
      models: [
        "gemini-flash-latest",
        "gemini-flash-lite-latest",
        "gpt-4o-mini",
        "gpt-5.4-mini",
      ],
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

  it("disables the settings when the last configured provider key is deleted", async () => {
    const { repository, service } = setup();
    await service.saveKey(userId, "openai", "openai-key");
    await service.reorderModels(userId, {
      models: ["gpt-4o-mini", "gpt-5.4-mini"],
    });

    const status = await service.deleteKey(userId, "openai");

    expect(repository.rows.get(userId)?.openai_api_key_encrypted).toBeNull();
    expect(status.enabled).toBe(false);
  });

  it("caches provider chains and invalidates the cache after settings changes", async () => {
    const { provider, providerFactory, service } = setup();
    await service.saveKey(userId, "anthropic", "key-one");
    await service.reorderModels(userId, {
      models: ["claude-haiku-4-5", "claude-sonnet-4-6"],
    });

    await expect(service.getProviderChain(userId)).resolves.toEqual([
      { provider: "anthropic", model: "claude-haiku-4-5", instance: provider },
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        instance: provider,
      },
    ]);
    await service.getProviderChain(userId);
    expect(providerFactory).toHaveBeenCalledTimes(2);
    expect(providerFactory).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "key-one",
      model: "claude-haiku-4-5",
    });

    await service.saveKey(userId, "anthropic", "key-two");
    await service.getProviderChain(userId);
    expect(providerFactory).toHaveBeenCalledTimes(4);
    expect(providerFactory).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "key-two",
      model: "claude-haiku-4-5",
    });
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

  it("builds the provider chain in the stored model_order across multiple providers", async () => {
    const { service } = setup();
    await service.saveKey(userId, "gemini", "gemini-key");
    await service.saveKey(userId, "anthropic", "anthropic-key");
    await service.reorderModels(userId, {
      models: [
        "claude-haiku-4-5",
        "claude-sonnet-4-6",
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
      ],
    });

    const chain = await service.getProviderChain(userId);

    expect(chain.map((candidate) => candidate.model)).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
    ]);
  });

  it("excludes models whose provider has no configured key from the chain", async () => {
    const { service } = setup();
    await service.saveKey(userId, "gemini", "gemini-key");

    const chain = await service.getProviderChain(userId);

    expect(chain.map((candidate) => candidate.provider)).toEqual([
      "gemini",
      "gemini",
    ]);
    expect(chain.some((candidate) => candidate.provider === "anthropic")).toBe(
      false,
    );
  });

  it("rejects reordering unless the submitted models are exactly the usable set", async () => {
    const { service } = setup();
    await service.saveKey(userId, "gemini", "gemini-key");
    await service.saveKey(userId, "anthropic", "anthropic-key");

    await expect(
      service.reorderModels(userId, {
        models: ["gemini-flash-lite-latest"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("syncs the provider and model columns to the first item on reorder success", async () => {
    const { repository, service } = setup();
    await service.saveKey(userId, "gemini", "gemini-key");
    await service.saveKey(userId, "anthropic", "anthropic-key");

    const status = await service.reorderModels(userId, {
      models: [
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
      ],
    });

    expect(status.provider).toBe("anthropic");
    expect(status.model).toBe("claude-sonnet-4-6");
    expect(status.modelOrder).toEqual([
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
    ]);
    expect(repository.rows.get(userId)?.provider).toBe("anthropic");
    expect(repository.rows.get(userId)?.model).toBe("claude-sonnet-4-6");
  });
});
