import { API_ERROR_CODES } from "@my-bookmark/shared";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export const errorMiddleware: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: API_ERROR_CODES.BAD_REQUEST,
        message: error.message,
      },
    });
    return;
  }

  response.status(500).json({
    error: {
      code: API_ERROR_CODES.INTERNAL_ERROR,
      message: "Internal server error",
    },
  });
};
