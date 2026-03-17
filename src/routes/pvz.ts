import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../config/env";
import { cdekGet } from "../services/cdekClient";
import { HttpError } from "../utils/httpError";

function normalizePvz(raw: any) {
  const source = Array.isArray(raw) ? raw : [];
  return source.map((item: any) => ({
    code: item.code,
    name: item.name,
    address: item.location?.address ?? item.address,
    city: item.location?.city ?? item.city,
    work_time: item.work_time,
    type: item.type,
    coordinates: item.location?.coordinates,
  }));
}

export async function registerPvzRoutes(app: FastifyInstance) {
  const handler = async (request: FastifyRequest<{ Querystring: { cityCode?: string } }>) => {
    const cityCode = String(request.query.cityCode ?? "").trim();

    if (!cityCode) {
      throw new HttpError(400, "CITY_CODE_REQUIRED", "cityCode is required");
    }

    const response = await cdekGet<any>(env, "ODN", `/v2/deliverypoints?city_code=${encodeURIComponent(cityCode)}`);
    return normalizePvz(response);
  };

  app.get("/api/pvz", handler);
  app.get("/api/cdek/pvz", handler);
}
