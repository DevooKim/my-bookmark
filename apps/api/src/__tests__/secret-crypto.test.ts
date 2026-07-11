import { describe, expect, it } from "vitest";
import { createSecretCipher, parseEncryptionKey } from "../lib/secret-crypto";

const key = Buffer.alloc(32, 7).toString("base64");

describe("secret cipher", () => {
  it("round-trips secrets with a fresh IV", () => {
    const cipher = createSecretCipher(parseEncryptionKey(key));
    const first = cipher.encrypt("provider-secret");
    const second = cipher.encrypt("provider-secret");

    expect(first).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(second).not.toBe(first);
    expect(cipher.decrypt(first)).toBe("provider-secret");
    expect(cipher.decrypt(second)).toBe("provider-secret");
  });

  it("rejects tampering and a different master key", () => {
    const encrypted = createSecretCipher(parseEncryptionKey(key)).encrypt(
      "provider-secret",
    );
    const parts = encrypted.split(":");
    parts[2] = Buffer.alloc(16, 1).toString("base64url");

    expect(() =>
      createSecretCipher(parseEncryptionKey(key)).decrypt(parts.join(":")),
    ).toThrow();
    expect(() =>
      createSecretCipher(Buffer.alloc(32, 8)).decrypt(encrypted),
    ).toThrow();
  });

  it("requires exactly 32 base64-encoded bytes", () => {
    expect(() => parseEncryptionKey("not-base64")).toThrow();
    expect(() =>
      parseEncryptionKey(Buffer.alloc(31).toString("base64")),
    ).toThrow();
    expect(parseEncryptionKey(key)).toHaveLength(32);
  });
});
