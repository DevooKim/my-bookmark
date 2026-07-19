import { API_ERROR_CODES, type ApiErrorCode } from "@my-bookmark/shared";
import type { ErrorRequestHandler } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import type { OperationalMonitor } from "../services/operational-monitor";
import type { createSecurityMonitor } from "./security-monitor";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function createHandler(options?: {
  operationalMonitor: OperationalMonitor;
  securityMonitor: ReturnType<typeof createSecurityMonitor>;
}): ErrorRequestHandler {
  return (error, request, response, _next) => {
    if (
      error instanceof SyntaxError &&
      (error as { type?: unknown }).type === "entity.parse.failed"
    ) {
      options?.securityMonitor.markMalformed(response);
      response.status(400).json({
        error: {
          code: API_ERROR_CODES.VALIDATION_ERROR,
          message: "Malformed JSON body",
        },
      });
      return;
    }
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: API_ERROR_CODES.VALIDATION_ERROR,
          message: "Validation failed",
          details: error.flatten(),
        },
      });
      return;
    }

    if (error instanceof MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      options?.securityMonitor.markMalformed(response);
      response.status(tooLarge ? 413 : 400).json({
        error: {
          code: API_ERROR_CODES.VALIDATION_ERROR,
          message: tooLarge
            ? "이미지는 20MB 이하여야 합니다"
            : "이미지 업로드 형식이 올바르지 않습니다",
        },
      });
      return;
    }

    if (error instanceof HttpError) {
      if (error.status >= 500) {
        options?.operationalMonitor.recordUnexpectedHttpError({
          status: error.status,
          method: request.method,
          path: request.path,
        });
      }
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    options?.operationalMonitor.recordUnexpectedHttpError({
      status: 500,
      method: request.method,
      path: request.path,
    });
    response.status(500).json({
      error: {
        code: API_ERROR_CODES.INTERNAL,
        message: "Internal server error",
      },
    });
  };
}

export const errorMiddleware = createHandler();

export function createErrorMiddleware(options: {
  operationalMonitor: OperationalMonitor;
  securityMonitor: ReturnType<typeof createSecurityMonitor>;
}): ErrorRequestHandler {
  return createHandler(options);
}
