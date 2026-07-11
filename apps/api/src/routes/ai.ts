import {
  aiConnectionTestResponseSchema,
  aiProviderNameSchema,
  aiStatusResponseSchema,
  saveAiProviderKeyRequestSchema,
  selectAiModelRequestSchema,
} from "@my-bookmark/shared";
import { type RequestHandler, Router } from "express";
import { getUserId, requireAuth } from "../middleware/auth";
import {
  type AiSettingsService,
  aiSettingsService,
} from "../services/ai-provider";

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

  router.put("/ai/model", async (request, response) => {
    const body = selectAiModelRequestSchema.parse(request.body);
    const status = await service.selectModel(getUserId(request), body);
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

  return router;
}

export const aiRouter = createAiRouter(aiSettingsService);
