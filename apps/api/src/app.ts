import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { appEnv } from "./lib/env";
import { errorMiddleware } from "./middleware/error";
import { aiRouter } from "./routes/ai";
import { bookmarksRouter } from "./routes/bookmarks";
import { categoriesRouter } from "./routes/categories";
import { healthRouter } from "./routes/health";
import { keysRouter } from "./routes/keys";
import { meRouter } from "./routes/me";

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: appEnv.WEB_ORIGIN }));
  app.use(express.json());
  app.use(pinoHttp({ level: appEnv.NODE_ENV === "test" ? "silent" : "info" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (request) => !request.header("X-API-Key"),
    }),
  );

  app.use("/api", healthRouter);
  app.use("/api", meRouter);
  app.use("/api", keysRouter);
  app.use("/api", categoriesRouter);
  app.use("/api", bookmarksRouter);
  app.use("/api", aiRouter);
  app.use(errorMiddleware);

  return app;
}
