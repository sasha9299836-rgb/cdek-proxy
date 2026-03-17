import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../config/env";
import { cdekGet } from "../services/cdekClient";
import { HttpError } from "../utils/httpError";

function normalizeCities(raw: any) {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.suggestions)
        ? raw.suggestions
        : [];

  return source.map((item: any) => ({
    code: item.code ?? item.city_code ?? item.id,
    name:
      item.name ??
      item.value ??
      item.city ??
      item.city_name ??
      item.cityFullName ??
      item.full_name ??
      item.fullName ??
      item.display_name,
    region: item.region ?? item.region_name ?? item.regionName,
  }));
}

export async function registerCitiesRoutes(app: FastifyInstance) {
  const handler = async (request: FastifyRequest<{ Querystring: { q?: string; size?: string } }>) => {
    const q = String(request.query.q ?? "").trim();
    const size = String(request.query.size ?? "10").trim();

    if (!q) {
      throw new HttpError(400, "CITY_QUERY_REQUIRED", "q is required");
    }

    const path = `/v2/location/suggest/cities?country_code=RU&name=${encodeURIComponent(q)}&size=${encodeURIComponent(size)}`;
    const response = await cdekGet<any>(env, "ODN", path);
    return normalizeCities(response);
  };

  app.get("/api/cities", handler);
  app.get("/api/cdek/cities", handler);
}
