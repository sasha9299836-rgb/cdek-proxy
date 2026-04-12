import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { writeAdminDraftPost } from "../services/adminDraftPostService";

export async function writeDraftPostHandler(request: FastifyRequest<{ Body: { post_id?: unknown; payload?: unknown } }>) {
  console.info(JSON.stringify({
    scope: "admin-draft-post",
    event: "draft_write_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-draft-post",
    event: "draft_write_auth_start",
  }));
  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(adminToken);
  console.info(JSON.stringify({
    scope: "admin-draft-post",
    event: "draft_write_auth_ok",
  }));

  const result = await writeAdminDraftPost(request.body ?? {});
  console.info(JSON.stringify({
    scope: "admin-draft-post",
    event: "draft_write_response_sent",
    branch: result.branch,
    post_id: (result.post as { id?: string })?.id ?? null,
  }));
  return result;
}
