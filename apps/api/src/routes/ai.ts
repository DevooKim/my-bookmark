import {
  API_ERROR_CODES,
  aiAnalyticsResponseSchema,
  aiStatusResponseSchema,
  aiUsageQuerySchema,
  aiUsageResponseSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { appEnv } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { getAiStatus, testAiConnection } from "../services/ai-provider";
import {
  fetchAccountUsage,
  fetchAnalytics,
  listAiUsageEvents,
} from "../services/ai-usage";

export function createAiRouter(
  authMiddleware: RequestHandler = requireAuth(),
): Router {
  const router = Router();
  router.use("/ai", authMiddleware);

  router.get("/ai", async (_request, response) => {
    response.json(aiStatusResponseSchema.parse(getAiStatus()));
  });

  router.post("/ai/test", async (_request, response) => {
    response.json({ ok: await testAiConnection() });
  });

  router.get("/ai/usage", async (request, response) => {
    const query = aiUsageQuerySchema.parse(request.query);
    const items = await listAiUsageEvents(
      getUsageDb(),
      getUserId(request),
      query.days,
    );
    response.json(aiUsageResponseSchema.parse({ days: query.days, items }));
  });

  router.get("/ai/analytics", async (request, response) => {
    const query = aiUsageQuerySchema.parse(request.query);
    const managementKey = appEnv.OPEN_ROUTER_MANAGEMENT_KEY;
    const rows = managementKey
      ? await fetchAnalytics(managementKey, query.days)
      : [];
    response.json(
      aiAnalyticsResponseSchema.parse({
        days: query.days,
        configured: Boolean(managementKey),
        rows,
      }),
    );
  });

  router.get("/ai/account", async (_request, response) => {
    if (!appEnv.OPEN_ROUTER_API_KEY) {
      throw new HttpError(
        400,
        API_ERROR_CODES.VALIDATION_ERROR,
        "OPEN_ROUTER_API_KEY is not configured",
      );
    }
    const usage = await fetchAccountUsage(appEnv.OPEN_ROUTER_API_KEY);
    response.json(usage);
  });

  return router;
}

function getUsageDb() {
  if (!supabaseAdmin) {
    throw new HttpError(
      500,
      API_ERROR_CODES.INTERNAL,
      "Database is not configured",
    );
  }
  return supabaseAdmin;
}

export const aiRouter = createAiRouter();
