import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    AI_SETTINGS_ENCRYPTION_KEY: z.string().optional(),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    // express `trust proxy` — set to the proxy hop count (e.g. 1 behind
    // Caddy) so req.ip and the API-key rate limit see the real client IP
    TRUST_PROXY: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === "test") {
      return;
    }

    if (!env.SUPABASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_URL"],
        message: "SUPABASE_URL is required outside test",
      });
    }

    if (!env.SUPABASE_SECRET_KEY) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_SECRET_KEY"],
        message: "SUPABASE_SECRET_KEY is required outside test",
      });
    }

    if (!env.AI_SETTINGS_ENCRYPTION_KEY) {
      context.addIssue({
        code: "custom",
        path: ["AI_SETTINGS_ENCRYPTION_KEY"],
        message: "AI_SETTINGS_ENCRYPTION_KEY is required outside test",
      });
    }
  })
  .superRefine((env, context) => {
    if (!env.AI_SETTINGS_ENCRYPTION_KEY) {
      return;
    }
    const value = env.AI_SETTINGS_ENCRYPTION_KEY;
    const validBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(value);
    if (!validBase64 || Buffer.from(value, "base64").length !== 32) {
      context.addIssue({
        code: "custom",
        path: ["AI_SETTINGS_ENCRYPTION_KEY"],
        message: "AI_SETTINGS_ENCRYPTION_KEY must encode exactly 32 bytes",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): Env {
  return envSchema.parse(env);
}

export const appEnv = parseEnv(process.env);
