import { API_ERROR_CODES } from "@my-bookmark/shared";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type pino from "pino";
import pinoHttp, { type Options as PinoHttpOptions } from "pino-http";
import { appEnv } from "./lib/env";
import { errorMiddleware } from "./middleware/error";
import { aiRouter } from "./routes/ai";
import { bookmarksRouter } from "./routes/bookmarks";
import { categoriesRouter } from "./routes/categories";
import { healthRouter } from "./routes/health";
import { keysRouter } from "./routes/keys";
import { meRouter } from "./routes/me";
import { pushRouter } from "./routes/push";
import { remindersRouter } from "./routes/reminders";

interface HttpLoggerOptions extends PinoHttpOptions {
  stream?: pino.DestinationStream;
}

export function createHttpLogger(options: HttpLoggerOptions = {}) {
  const { stream, ...loggerOptions } = options;
  return pinoHttp(
    {
      level: appEnv.NODE_ENV === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.authorization",
          'req.headers["x-api-key"]',
          'req.headers["X-API-Key"]',
        ],
        censor: "[Redacted]",
      },
      ...loggerOptions,
    },
    stream,
  );
}

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: appEnv.WEB_ORIGIN }));
  app.use(express.json());
  app.use(createHttpLogger());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) =>
        !request.header("X-API-Key") || !isApiKeyAllowedPath(request.path),
      handler: (_request, response) => {
        response.status(429).json({
          error: {
            code: API_ERROR_CODES.RATE_LIMITED,
            message: "Too many requests",
          },
        });
      },
    }),
  );

  app.use("/api", healthRouter);
  app.use("/api", meRouter);
  app.use("/api", keysRouter);
  app.use("/api", categoriesRouter);
  app.use("/api", bookmarksRouter);
  app.use("/api", remindersRouter);
  app.use("/api", pushRouter);
  app.use("/api", aiRouter);
  app.use(errorMiddleware);

  return app;
}

function isApiKeyAllowedPath(path: string): boolean {
  return (
    path === "/bookmarks" ||
    path.startsWith("/bookmarks/") ||
    path === "/categories" ||
    path.startsWith("/categories/")
  );
}
