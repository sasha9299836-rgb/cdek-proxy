import type { FastifyInstance } from "fastify";
import { env } from "../config/env";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({
    ok: true,
    base: env.cdekBaseUrl,
    profiles: {
      MSK: {
        shipmentPoint: env.odnShipmentPoint,
        credentialsConfigured: Boolean(env.odnClientId && env.odnClientSecret),
        cityCode: env.mskCityCode,
      },
      YAN: {
        shipmentPoint: env.yanShipmentPoint,
        credentialsConfigured: Boolean(env.yanClientId && env.yanClientSecret),
        cityCode: env.yanCityCode,
      },
    },
  }));
}
