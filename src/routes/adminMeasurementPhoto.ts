import type { FastifyInstance } from "fastify";
import { createMeasurementPhotoHandler } from "../controllers/adminMeasurementPhotoController";

export async function registerAdminMeasurementPhotoRoutes(app: FastifyInstance) {
  app.post("/api/admin/measurement-photo/create", createMeasurementPhotoHandler);
}
