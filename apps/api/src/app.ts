import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { appEnv } from "./lib/env";
import { errorMiddleware } from "./middleware/error";
import { healthRouter } from "./routes/health";

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: appEnv.WEB_ORIGIN }));
  app.use(express.json());
  app.use(pinoHttp({ level: appEnv.NODE_ENV === "test" ? "silent" : "info" }));

  app.use("/api", healthRouter);
  app.use(errorMiddleware);

  return app;
}
