import type { FastifyInstance } from "fastify";
import { upsertDropTeaserHandler } from "../controllers/adminDropTeaserController";

export async function registerAdminDropTeaserRoutes(app: FastifyInstance) {
  app.post("/api/admin/drop-teaser/upsert", upsertDropTeaserHandler);
}

