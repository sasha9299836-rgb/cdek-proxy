import type { FastifyInstance } from "fastify";
import { uploadDefectVideoHandler } from "../controllers/adminDefectVideoUploadController";

export async function registerAdminDefectVideoUploadRoutes(app: FastifyInstance) {
  app.post("/api/admin/defect-video/upload", uploadDefectVideoHandler);
}

