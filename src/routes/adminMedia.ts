import type { FastifyInstance } from "fastify";
import { uploadMainPhotoHandler } from "../controllers/adminMediaController";

export async function registerAdminMediaRoutes(app: FastifyInstance) {
  app.post("/api/admin/media/main/upload", uploadMainPhotoHandler);
}
