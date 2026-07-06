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
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience });

      if (!payload.sub) {
        throw new Error("Missing subject");
      }

      return payload.sub;
    } catch {
      throw new HttpError(
        401,
        API_ERROR_CODES.UNAUTHORIZED,
        "Invalid bearer token",
      );
    }
  };
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

export function requireAuth() {
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
      request.userId = await bearerAuth(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}
