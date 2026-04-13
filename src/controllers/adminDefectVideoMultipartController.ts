import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import {
  completeDefectVideoMultipart,
  startDefectVideoMultipart,
} from "../services/adminDefectVideoMultipartService";

export async function startDefectVideoMultipartHandler(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_start_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_start_auth_start",
  }));
  try {
    const token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
    await requireValidAdminSession(token);
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "admin-defect-video-multipart",
      event: "defect_video_multipart_start_auth_fail",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_start_auth_ok",
  }));

  const result = await startDefectVideoMultipart(request.body ?? {});

  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_start_response_sent",
    post_id: String((request.body as Record<string, unknown>)?.post_id ?? "").trim() || null,
    photo_no: Number((request.body as Record<string, unknown>)?.photo_no ?? 0) || null,
  }));

  return result;
}

export async function completeDefectVideoMultipartHandler(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_complete_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_complete_auth_start",
  }));
  try {
    const token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
    await requireValidAdminSession(token);
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "admin-defect-video-multipart",
      event: "defect_video_multipart_complete_auth_fail",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_complete_auth_ok",
  }));

  const result = await completeDefectVideoMultipart(request.body ?? {});

  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_complete_response_sent",
    post_id: String((request.body as Record<string, unknown>)?.post_id ?? "").trim() || null,
    storage_key: String((request.body as Record<string, unknown>)?.storage_key ?? "").trim() || null,
  }));

  return result;
}
