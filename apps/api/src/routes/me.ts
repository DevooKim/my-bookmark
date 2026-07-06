import type { MeResponse } from "@my-bookmark/shared";
import { Router } from "express";
import { requireAuth } from "../middleware/auth";

export const meRouter = Router();

meRouter.get("/me", requireAuth(), (request, response) => {
  const body: MeResponse = { userId: request.userId ?? "" };
  response.json(body);
});
