import type { MeResponse } from "@my-bookmark/shared";
import { Router } from "express";
import { getUserId, requireAuth } from "../middleware/auth";

export const meRouter = Router();

meRouter.get("/me", requireAuth(), (request, response) => {
  const body: MeResponse = { userId: getUserId(request) };
  response.json(body);
});
