import type { FastifyRequest } from "fastify";
import { HttpError } from "../utils/httpError";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { createDefectPhotoRecord, deleteDefectPhotoRecord } from "../services/adminDefectPhotoService";

function readFieldValue(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key] as { value?: unknown } | undefined;
  return String(raw?.value ?? "").trim();
}

export async function createDefectPhotoHandler(request: FastifyRequest) {
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_create_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_create_auth_start",
  }));
  let token = "";
  try {
    token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
    await requireValidAdminSession(token);
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "admin-defect-photo",
      event: "defect_photo_create_auth_fail",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_create_auth_ok",
  }));

  const filePart = await request.file();
  if (!filePart) {
    throw new HttpError(400, "BAD_PAYLOAD", "file is required");
  }

  const fields = (filePart.fields ?? {}) as Record<string, unknown>;
  const postId = readFieldValue(fields, "post_id");
  const photoNoRaw = readFieldValue(fields, "photo_no");
  const itemIdRaw = readFieldValue(fields, "item_id");
  const mediaTypeRaw = readFieldValue(fields, "media_type");

  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_multipart_parsed",
    post_id: postId || null,
    photo_no_raw: photoNoRaw || null,
    item_id_raw: itemIdRaw || null,
    media_type: mediaTypeRaw || null,
    mime: filePart.mimetype,
    filename: filePart.filename,
  }));

  const result = await createDefectPhotoRecord({
    file: filePart,
    postId,
    photoNo: Number(photoNoRaw),
    itemId: itemIdRaw ? Number(itemIdRaw) : null,
    mediaType: mediaTypeRaw,
  });

  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_create_response_sent",
    post_id: postId || null,
    photo_no: Number(photoNoRaw || 0),
    media_type: mediaTypeRaw || null,
  }));

  return result;
}

export async function deleteDefectPhotoHandler(
  request: FastifyRequest<{ Body: { id?: unknown; storage_key?: unknown } }>,
) {
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_delete_route_hit",
    method: request.method,
    url: request.url,
  }));

  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_delete_auth_start",
  }));
  let token = "";
  try {
    token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
    await requireValidAdminSession(token);
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "admin-defect-photo",
      event: "defect_photo_delete_auth_fail",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_delete_auth_ok",
  }));

  const result = await deleteDefectPhotoRecord(request.body ?? {});

  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_delete_response_sent",
    id: Number((request.body as { id?: unknown })?.id ?? 0) || null,
    storage_key: String((request.body as { storage_key?: unknown })?.storage_key ?? "").trim() || null,
  }));

  return result;
}
