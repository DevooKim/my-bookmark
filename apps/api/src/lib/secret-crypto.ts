import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

export function parseEncryptionKey(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("AI_SETTINGS_ENCRYPTION_KEY must be valid base64");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("AI_SETTINGS_ENCRYPTION_KEY must encode exactly 32 bytes");
  }
  return key;
}

export function createSecretCipher(key: Buffer): SecretCipher {
  if (key.length !== 32) {
    throw new Error("AES-256-GCM requires a 32-byte key");
  }

  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(":");
    },
    decrypt(payload) {
      const [version, ivValue, tagValue, ciphertextValue, extra] =
        payload.split(":");
      if (
        version !== "v1" ||
        !ivValue ||
        !tagValue ||
        !ciphertextValue ||
        extra !== undefined
      ) {
        throw new Error("Invalid encrypted secret format");
      }
      const iv = Buffer.from(ivValue, "base64url");
      const tag = Buffer.from(tagValue, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new Error("Invalid encrypted secret format");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
