import type { FastifyInstance } from "fastify";
import { createHandler, quoteHandler, statusHandler } from "../controllers/shippingController";

export async function registerShippingRoutes(app: FastifyInstance) {
  app.post("/api/shipping/quote", quoteHandler);
  app.post("/api/shipping/create", createHandler);
  app.get("/api/shipping/status/:uuid", statusHandler);
}
