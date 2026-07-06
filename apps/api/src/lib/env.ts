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
    AI_PROVIDER: z.enum(["gemini", "anthropic", "openai"]).default("gemini"),
    GEMINI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
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
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: NodeJS.ProcessEnv): Env {
  return envSchema.parse(env);
}

export const appEnv = parseEnv(process.env);
