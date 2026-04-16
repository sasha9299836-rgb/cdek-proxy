import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { upsertAdminDropTeaser } from "../services/adminDropTeaserService";

type UpsertDropTeaserBody = {
  title?: unknown;
  short_text?: unknown;
  details?: unknown;
  preview_images?: unknown;
};

export async function upsertDropTeaserHandler(
  request: FastifyRequest<{ Body: UpsertDropTeaserBody }>,
) {
  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(adminToken);

  return upsertAdminDropTeaser(request.body ?? {});
}

