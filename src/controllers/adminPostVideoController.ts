import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { updateAdminPostVideoUrl } from "../services/adminPostVideoService";

export async function updatePostVideoHandler(
  request: FastifyRequest<{ Body: { post_id?: unknown; video_url?: unknown } }>,
) {
  console.info(JSON.stringify({
    scope: "admin-post-video",
    event: "post_video_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-post-video",
    event: "post_video_auth_start",
  }));
  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(adminToken);
  console.info(JSON.stringify({
    scope: "admin-post-video",
    event: "post_video_auth_ok",
  }));

  const result = await updateAdminPostVideoUrl(request.body ?? {});
  console.info(JSON.stringify({
    scope: "admin-post-video",
    event: "post_video_response_sent",
    post_id: result.post_id,
    has_video_url: Boolean(result.video_url),
  }));
  return result;
}
