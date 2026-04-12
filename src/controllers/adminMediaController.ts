import type { FastifyRequest } from "fastify";
import { HttpError } from "../utils/httpError";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { uploadMainPhotoToStorage } from "../services/adminMediaService";

function readFieldValue(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key] as { value?: unknown } | undefined;
  return String(raw?.value ?? "").trim();
}

export async function uploadMainPhotoHandler(request: FastifyRequest) {
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_route_hit",
    method: request.method,
    url: request.url,
  }));

  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_token_received",
    token_present: Boolean(adminToken),
    token_length: adminToken.length,
  }));

  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_admin_validation_start",
  }));
  await requireValidAdminSession(adminToken);
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_admin_validation_passed",
  }));

  const filePart = await request.file();
  if (!filePart) {
    throw new HttpError(400, "BAD_PAYLOAD", "file is required");
  }

  const fields = (filePart.fields ?? {}) as Record<string, unknown>;
  const postId = readFieldValue(fields, "post_id");
  const photoNoRaw = readFieldValue(fields, "photo_no");
  const itemIdRaw = readFieldValue(fields, "item_id");
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_multipart_parsed",
    post_id: postId || null,
    photo_no_raw: photoNoRaw || null,
    item_id_raw: itemIdRaw || null,
    mime: filePart.mimetype,
    filename: filePart.filename,
  }));

  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_storage_start",
  }));
  try {
    const result = await uploadMainPhotoToStorage({
      file: filePart,
      postId,
      photoNo: Number(photoNoRaw),
      itemId: itemIdRaw ? Number(itemIdRaw) : null,
    });
    console.info(JSON.stringify({
      scope: "admin-media",
      event: "main_upload_storage_success",
      key: result.key,
      photo_no: result.photo_no,
    }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      scope: "admin-media",
      event: "main_upload_storage_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}
