import { aiStatusResponseSchema } from "@my-bookmark/shared";
import { Router } from "express";
import { getUserId, requireAuth } from "../middleware/auth";
import { getAiProviderLabel } from "../services/ai-provider";

export const aiRouter = Router();

aiRouter.get("/ai", requireAuth(), (request, response) => {
  getUserId(request);
  response.json(
    aiStatusResponseSchema.parse({ provider: getAiProviderLabel() }),
  );
});
