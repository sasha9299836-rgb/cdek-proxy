import type { FastifyInstance } from "fastify";
import { updatePostVideoHandler } from "../controllers/adminPostVideoController";

export async function registerAdminPostVideoRoutes(app: FastifyInstance) {
  app.post("/api/admin/post-video/update", updatePostVideoHandler);
}
