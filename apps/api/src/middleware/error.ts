import { API_ERROR_CODES, type ApiErrorCode } from "@my-bookmark/shared";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

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

export const errorMiddleware: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
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

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  response.status(500).json({
    error: {
      code: API_ERROR_CODES.INTERNAL,
      message: "Internal server error",
    },
  });
};
