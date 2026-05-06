import type { FastifyInstance } from "fastify";
import { clearActiveDropTeaserHandler, getActiveDropTeaserHandler, upsertDropTeaserHandler } from "../controllers/adminDropTeaserController";

export async function registerAdminDropTeaserRoutes(app: FastifyInstance) {
  app.get("/api/admin/drop-teaser/active", getActiveDropTeaserHandler);
  app.post("/api/admin/drop-teaser/upsert", upsertDropTeaserHandler);
  app.post("/api/admin/drop-teaser/clear", clearActiveDropTeaserHandler);
}
