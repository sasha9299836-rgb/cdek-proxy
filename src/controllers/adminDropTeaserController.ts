import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { clearActiveAdminDropTeaser, upsertAdminDropTeaser } from "../services/adminDropTeaserService";

type UpsertDropTeaserBody = {
  title?: unknown;
  short_text?: unknown;
  details?: unknown;
  preview_images?: unknown;
  is_public_immediately?: unknown;
};

export async function upsertDropTeaserHandler(
  request: FastifyRequest<{ Body: UpsertDropTeaserBody }>,
) {
  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(adminToken);

  return upsertAdminDropTeaser(request.body ?? {});
}

export async function clearActiveDropTeaserHandler(
  request: FastifyRequest,
) {
  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(adminToken);

  return clearActiveAdminDropTeaser();
}
