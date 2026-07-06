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

export function requireAuth(verify: BearerVerifier = bearerAuth) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const authorization = request.header("Authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      next(
        new HttpError(
          401,
          API_ERROR_CODES.UNAUTHORIZED,
          "Missing bearer token",
        ),
      );
      return;
    }

    try {
      request.userId = await verify(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

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
