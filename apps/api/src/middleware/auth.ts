import { createHash } from "node:crypto";
import { API_ERROR_CODES } from "@my-bookmark/shared";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { appEnv } from "../lib/env";
import { HttpError } from "./error";

interface BearerAuthOptions {
  issuer: string;
  audience: string;
  jwks: JWTVerifyGetKey;
}

export function createBearerAuth({
  issuer,
  audience,
  jwks,
}: BearerAuthOptions) {
  return async (token: string): Promise<string> => {
    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
    } catch (error) {
      // JWKS fetch 실패(네트워크/Supabase 장애)와 토큰 무효를 구분한다.
      // 전자는 401로 뭉개면 유효 세션 사용자가 로그아웃당하므로 502로 올린다.
      if (isKeyResolutionError(error)) {
        throw new HttpError(
          502,
          API_ERROR_CODES.INTERNAL,
          "Unable to verify token: auth key set unavailable",
        );
      }
      throw new HttpError(
        401,
        API_ERROR_CODES.UNAUTHORIZED,
        "Invalid bearer token",
      );
    }

    if (!payload.sub) {
      throw new HttpError(
        401,
        API_ERROR_CODES.UNAUTHORIZED,
        "Invalid bearer token",
      );
    }

    return payload.sub;
  };
}

// jose는 JWKS를 가져오지 못하면 JWKSNoMatchingKey / 하위의 fetch 에러를 던진다.
// 서명 검증 실패(만료/변조)와 달리 이건 서버측 일시 장애다.
function isKeyResolutionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    code === "ERR_JWKS_TIMEOUT" ||
    code === "ERR_JWKS_NO_MATCHING_KEY" ||
    code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS"
  );
}

export function createSupabaseJwksUrl(supabaseUrl: string) {
  return new URL("/auth/v1/.well-known/jwks.json", supabaseUrl);
}

const issuer = appEnv.SUPABASE_URL
  ? `${appEnv.SUPABASE_URL}/auth/v1`
  : "http://localhost/auth/v1";
const remoteJwks = appEnv.SUPABASE_URL
  ? createRemoteJWKSet(createSupabaseJwksUrl(appEnv.SUPABASE_URL))
  : undefined;

export const bearerAuth = remoteJwks
  ? createBearerAuth({ issuer, audience: "authenticated", jwks: remoteJwks })
  : async () => {
      throw new HttpError(
        401,
        API_ERROR_CODES.UNAUTHORIZED,
        "Authentication is not configured",
      );
    };

export type BearerVerifier = (token: string) => Promise<string>;
export type ApiKeyVerifier = (key: string) => Promise<string>;

interface RequireAuthOptions {
  bearer?: BearerVerifier;
  apiKey?: boolean;
  apiKeyVerifier?: ApiKeyVerifier;
}

interface ApiKeyRow {
  user_id: string;
  last_used_at: string | null;
}

interface ApiKeyLookupDb {
  from(table: "api_keys"): {
    select(columns: string): {
      eq(
        field: string,
        value: string,
      ): {
        is(
          field: string,
          value: null,
        ): {
          maybeSingle(): PromiseLike<{
            data: ApiKeyRow | null;
            error: unknown;
          }>;
        };
      };
    };
    update(values: { last_used_at: string }): {
      eq(
        field: string,
        value: string,
      ): {
        is(field: string, value: null): PromiseLike<{ error: unknown }>;
      };
    };
  };
}

const lastUsedUpdateCache = new Map<string, number>();
const lastUsedThrottleMs = 60_000;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createApiKeyVerifier(
  db: unknown,
  now: () => Date = () => new Date(),
): ApiKeyVerifier {
  const apiKeyDb = db as ApiKeyLookupDb;
  return async (key: string): Promise<string> => {
    const keyHash = hashApiKey(key);
    const { data, error } = await apiKeyDb
      .from("api_keys")
      .select("user_id,last_used_at")
      .eq("key_hash", keyHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      throw new HttpError(401, API_ERROR_CODES.UNAUTHORIZED, "Invalid API key");
    }

    const timestamp = now().getTime();
    const cachedAt = lastUsedUpdateCache.get(keyHash) ?? 0;
    const persistedAt = data.last_used_at
      ? Date.parse(data.last_used_at)
      : Number.NEGATIVE_INFINITY;
    if (
      timestamp - cachedAt >= lastUsedThrottleMs &&
      timestamp - persistedAt >= lastUsedThrottleMs
    ) {
      const { error: updateError } = await apiKeyDb
        .from("api_keys")
        .update({ last_used_at: new Date(timestamp).toISOString() })
        .eq("key_hash", keyHash)
        .is("revoked_at", null);
      if (updateError) {
        throw updateError;
      }
      lastUsedUpdateCache.set(keyHash, timestamp);
    }

    return data.user_id;
  };
}

export function requireAuth(options: RequireAuthOptions | BearerVerifier = {}) {
  const authOptions: RequireAuthOptions =
    typeof options === "function" ? { bearer: options } : options;
  const verifyBearer = authOptions.bearer ?? bearerAuth;
  return async (request: Request, _response: Response, next: NextFunction) => {
    const authorization = request.header("Authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const apiKey = request.header("X-API-Key");

    try {
      if (token) {
        request.userId = await verifyBearer(token);
        next();
        return;
      }

      if (apiKey && authOptions.apiKey) {
        const verifyApiKey =
          authOptions.apiKeyVerifier ?? defaultApiKeyVerifier;
        request.userId = await verifyApiKey(apiKey);
        next();
        return;
      }

      next(
        new HttpError(
          401,
          API_ERROR_CODES.UNAUTHORIZED,
          token ? "Invalid bearer token" : "Missing bearer token",
        ),
      );
    } catch (error) {
      next(error);
    }
  };
}

const defaultApiKeyVerifier: ApiKeyVerifier = async (key: string) => {
  if (!appEnv.SUPABASE_URL || !appEnv.SUPABASE_SECRET_KEY) {
    throw new HttpError(
      401,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is not configured",
    );
  }
  const { supabaseAdmin } = await import("../lib/supabase");
  if (!supabaseAdmin) {
    throw new HttpError(
      401,
      API_ERROR_CODES.UNAUTHORIZED,
      "Authentication is not configured",
    );
  }
  return createApiKeyVerifier(supabaseAdmin)(key);
};

// requireAuth 통과 후 호출 전제. userId가 없으면 미들웨어가 우회된 것이므로
// 빈 값을 응답에 흘리는 대신 서버 에러로 드러낸다.
export function getUserId(request: Request): string {
  if (!request.userId) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Missing authenticated user",
    );
  }
  return request.userId;
}
