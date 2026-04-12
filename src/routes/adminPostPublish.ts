import type { FastifyInstance } from "fastify";
import { publishPostHandler } from "../controllers/adminPostPublishController";

export async function registerAdminPostPublishRoutes(app: FastifyInstance) {
  app.post("/api/admin/post/publish", publishPostHandler);
}
