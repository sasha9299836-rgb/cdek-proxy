import type { FastifyInstance } from "fastify";
import { createPostPhotoHandler } from "../controllers/adminPostPhotoController";

export async function registerAdminPostPhotoRoutes(app: FastifyInstance) {
  app.post("/api/admin/post-photo/create", createPostPhotoHandler);
}
