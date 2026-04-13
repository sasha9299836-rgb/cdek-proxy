import type { FastifyInstance } from "fastify";
import { presignDefectVideoHandler } from "../controllers/adminDefectVideoPresignController";

export async function registerAdminDefectVideoPresignRoutes(app: FastifyInstance) {
  app.post("/api/admin/defect-video/presign", presignDefectVideoHandler);
}
