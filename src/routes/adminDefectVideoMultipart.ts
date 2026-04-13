import type { FastifyInstance } from "fastify";
import {
  completeDefectVideoMultipartHandler,
  startDefectVideoMultipartHandler,
} from "../controllers/adminDefectVideoMultipartController";

export async function registerAdminDefectVideoMultipartRoutes(app: FastifyInstance) {
  app.post("/api/admin/defect-video/multipart/start", startDefectVideoMultipartHandler);
  app.post("/api/admin/defect-video/multipart/complete", completeDefectVideoMultipartHandler);
}
