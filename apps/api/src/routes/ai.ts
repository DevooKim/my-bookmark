import {
  API_ERROR_CODES,
  aiConnectionTestResponseSchema,
  aiProviderNameSchema,
  aiStatusResponseSchema,
  aiUsageQuerySchema,
  aiUsageResponseSchema,
  reorderAiModelsRequestSchema,
  saveAiProviderKeyRequestSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { getUserId, requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import {
  type AiSettingsService,
  aiSettingsService,
} from "../services/ai-provider";
import { listAiUsageEvents } from "../services/ai-usage";

export function createAiRouter(
  service: AiSettingsService,
  authMiddleware: RequestHandler = requireAuth(),
): Router {
  const router = Router();
  router.use("/ai", authMiddleware);

  router.get("/ai", async (request, response) => {
    const status = await service.getStatus(getUserId(request));
    response.json(aiStatusResponseSchema.parse(status));
  });

  router.put("/ai/keys/:provider", async (request, response) => {
    const provider = aiProviderNameSchema.parse(request.params.provider);
    const body = saveAiProviderKeyRequestSchema.parse(request.body);
    const status = await service.saveKey(
      getUserId(request),
      provider,
      body.apiKey,
    );
    response.json(aiStatusResponseSchema.parse(status));
  });

  router.put("/ai/model-order", async (request, response) => {
    const body = reorderAiModelsRequestSchema.parse(request.body);
    const status = await service.reorderModels(getUserId(request), body);
    response.json(aiStatusResponseSchema.parse(status));
  });

  router.post("/ai/test/:provider", async (request, response) => {
    const provider = aiProviderNameSchema.parse(request.params.provider);
    const ok = await service.testConnection(getUserId(request), provider);
    response.json(aiConnectionTestResponseSchema.parse({ provider, ok }));
  });

  router.delete("/ai/keys/:provider", async (request, response) => {
    const provider = aiProviderNameSchema.parse(request.params.provider);
    const status = await service.deleteKey(getUserId(request), provider);
    response.json(aiStatusResponseSchema.parse(status));
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

export const aiRouter = createAiRouter(aiSettingsService);
