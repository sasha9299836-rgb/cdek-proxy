import type { FastifyInstance } from "fastify";
import { clearActiveDropTeaserHandler, upsertDropTeaserHandler } from "../controllers/adminDropTeaserController";

export async function registerAdminDropTeaserRoutes(app: FastifyInstance) {
  app.post("/api/admin/drop-teaser/upsert", upsertDropTeaserHandler);
  app.post("/api/admin/drop-teaser/clear", clearActiveDropTeaserHandler);
}
