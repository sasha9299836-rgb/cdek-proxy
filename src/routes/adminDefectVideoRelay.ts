import type { FastifyInstance } from "fastify";
import {
  abortDefectVideoRelayHandler,
  completeDefectVideoRelayHandler,
  startDefectVideoRelayHandler,
  uploadDefectVideoRelayPartHandler,
} from "../controllers/adminDefectVideoRelayController";

export async function registerAdminDefectVideoRelayRoutes(app: FastifyInstance) {
  app.post("/api/admin/defect-video/relay/start", startDefectVideoRelayHandler);
  app.post("/api/admin/defect-video/relay/part", uploadDefectVideoRelayPartHandler);
  app.post("/api/admin/defect-video/relay/complete", completeDefectVideoRelayHandler);
  app.post("/api/admin/defect-video/relay/abort", abortDefectVideoRelayHandler);
}

