import { Router } from "express";
import {
  defaultReadinessService,
  type ReadinessService,
} from "../services/readiness";

export function createHealthRouter({
  readiness,
}: {
  readiness: ReadinessService;
}) {
  const router = Router();

  router.get("/health", (_request, response) => {
    response.json({ ok: true });
  });
  router.get("/health/ready", async (_request, response) => {
    const snapshot = await readiness.check();
    response.status(snapshot.ok ? 200 : 503).json(snapshot);
  });
  return router;
}

export const healthRouter = createHealthRouter({
  readiness: defaultReadinessService,
});
