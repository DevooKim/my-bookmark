import { API_ERROR_CODES } from "@my-bookmark/shared";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type pino from "pino";
import pinoHttp, { type Options as PinoHttpOptions } from "pino-http";
import { appEnv } from "./lib/env";
import { createErrorMiddleware } from "./middleware/error";
import { createSecurityMonitor } from "./middleware/security-monitor";
import { aiRouter } from "./routes/ai";
import { bookmarksRouter } from "./routes/bookmarks";
import { categoriesRouter } from "./routes/categories";
import { createHealthRouter } from "./routes/health";
import { imagesRouter } from "./routes/images";
import { keysRouter } from "./routes/keys";
import { meRouter } from "./routes/me";
import { pushRouter } from "./routes/push";
import { remindersRouter } from "./routes/reminders";
import { shareRouter } from "./routes/share";
import {
  type AlertDispatcher,
  defaultAlertDispatcher,
} from "./services/alerting";
import {
  defaultOperationalMonitor,
  type OperationalMonitor,
} from "./services/operational-monitor";
import {
  defaultReadinessService,
  type ReadinessService,
} from "./services/readiness";

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

export interface CreateAppOptions {
  alerts?: AlertDispatcher;
  securityMonitor?: ReturnType<typeof createSecurityMonitor>;
  readiness?: ReadinessService;
  operationalMonitor?: OperationalMonitor;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  const securityMonitor =
    options.securityMonitor ??
    createSecurityMonitor({ alerts: options.alerts ?? defaultAlertDispatcher });

  if (appEnv.TRUST_PROXY !== undefined) {
    app.set("trust proxy", parseTrustProxy(appEnv.TRUST_PROXY));
  }

  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: appEnv.WEB_ORIGIN }));
  app.use(createHttpLogger());
  app.use(securityMonitor.middleware);
  app.use(express.json());
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

  app.use(
    "/api",
    createHealthRouter({
      readiness: options.readiness ?? defaultReadinessService,
    }),
  );
  app.use("/api", meRouter);
  app.use("/api", keysRouter);
  app.use("/api", categoriesRouter);
  app.use("/api", bookmarksRouter);
  app.use("/api", imagesRouter);
  app.use("/api", shareRouter);
  app.use("/api", remindersRouter);
  app.use("/api", pushRouter);
  app.use("/api", aiRouter);
  app.use("/api", (_request, response) => {
    Object.assign(response.locals, { securityRouteNotFound: true });
    response.status(404).json({
      error: { code: API_ERROR_CODES.NOT_FOUND, message: "Route not found" },
    });
  });
  app.use(
    createErrorMiddleware({
      operationalMonitor:
        options.operationalMonitor ?? defaultOperationalMonitor,
      securityMonitor,
    }),
  );

  return app;
}

export function parseTrustProxy(value: string): boolean | number | string {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : value;
}

function isApiKeyAllowedPath(path: string): boolean {
  return (
    path === "/share" ||
    path.startsWith("/share/") ||
    path === "/bookmarks" ||
    path.startsWith("/bookmarks/") ||
    path === "/images" ||
    path === "/categories" ||
    path.startsWith("/categories/")
  );
}
