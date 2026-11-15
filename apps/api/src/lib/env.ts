import { DEFAULT_MODELS } from "@my-bookmark/ai";
import { z } from "zod";

// 쉼표로 구분한 OpenRouter 모델 id 목록. 비어 있으면 기본 폴백 순서를 쓴다.
const openRouterModelsSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .pipe(
      z
        .array(z.string().regex(/^[\w.-]+\/[\w.:-]+$/, "Invalid model id"))
        .min(1)
        .refine((models) => new Set(models).size === models.length, {
          message: "Duplicate model id",
        }),
    )
    .optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_ORIGIN: z.url().default("http://localhost:3000"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    OPEN_ROUTER_API_KEY: z.string().min(1).optional(),
    OPEN_ROUTER_MANAGEMENT_KEY: z.string().min(1).optional(),
    OPEN_ROUTER_MODELS: openRouterModelsSchema.transform(
      (models) => models ?? [...DEFAULT_MODELS],
    ),
    NAVER_SEARCH_CLIENT_ID: z.string().min(1).optional(),
    NAVER_SEARCH_CLIENT_SECRET: z.string().min(1).optional(),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    // express `trust proxy` — set to the proxy hop count (e.g. 1 behind
    // Caddy) so req.ip and the API-key rate limit see the real client IP
    TRUST_PROXY: z.string().min(1).optional(),
    DISCORD_ALERT_WEBHOOK_URL: z.url().optional(),
    ALERT_ENV: z.string().min(1).default("home-production"),
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
