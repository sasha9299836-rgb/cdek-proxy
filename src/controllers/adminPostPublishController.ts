import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { publishPostById } from "../services/adminPostPublishService";

export async function publishPostHandler(request: FastifyRequest<{ Body: { post_id?: unknown } }>) {
  console.info(JSON.stringify({
    scope: "admin-post-publish",
    event: "post_publish_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-post-publish",
    event: "post_publish_auth_start",
  }));
  try {
    const token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
    await requireValidAdminSession(token);
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "admin-post-publish",
      event: "post_publish_auth_fail",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  console.info(JSON.stringify({
    scope: "admin-post-publish",
    event: "post_publish_auth_ok",
  }));

  const result = await publishPostById(request.body ?? {});
  console.info(JSON.stringify({
    scope: "admin-post-publish",
    event: "post_publish_response_sent",
    post_id: result.post_id,
    status: result.status,
  }));
  return result;
}
