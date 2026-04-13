import type { FastifyRequest } from "fastify";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { createMeasurementPhotoRecord } from "../services/adminMeasurementPhotoService";

export async function createMeasurementPhotoHandler(
  request: FastifyRequest<{ Body: { post_id?: unknown; photo_no?: unknown; storage_key?: unknown } }>,
) {
  console.info(JSON.stringify({
    scope: "admin-measurement-photo",
    event: "measurement_photo_create_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-measurement-photo",
    event: "measurement_photo_create_auth_start",
  }));
  let token = "";
  try {
    token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
    await requireValidAdminSession(token);
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "admin-measurement-photo",
      event: "measurement_photo_create_auth_fail",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  console.info(JSON.stringify({
    scope: "admin-measurement-photo",
    event: "measurement_photo_create_auth_ok",
  }));

  const result = await createMeasurementPhotoRecord(request.body ?? {});

  console.info(JSON.stringify({
    scope: "admin-measurement-photo",
    event: "measurement_photo_create_response_sent",
    post_id: String(request.body?.post_id ?? ""),
    photo_no: Number(request.body?.photo_no ?? 0),
  }));

  return result;
}
