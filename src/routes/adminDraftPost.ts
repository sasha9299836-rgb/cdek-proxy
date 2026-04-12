import type { FastifyInstance } from "fastify";
import { writeDraftPostHandler } from "../controllers/adminDraftPostController";

export async function registerAdminDraftPostRoutes(app: FastifyInstance) {
  app.post("/api/admin/draft-post/write", writeDraftPostHandler);
}
