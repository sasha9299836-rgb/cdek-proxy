import type { FastifyInstance } from "fastify";
import { createDefectPhotoHandler, deleteDefectPhotoHandler } from "../controllers/adminDefectPhotoController";

export async function registerAdminDefectPhotoRoutes(app: FastifyInstance) {
  app.post("/api/admin/defect-photo/create", createDefectPhotoHandler);
  app.post("/api/admin/defect-photo/delete", deleteDefectPhotoHandler);
}
