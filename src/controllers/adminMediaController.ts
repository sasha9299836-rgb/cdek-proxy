import type { FastifyRequest } from "fastify";
import { HttpError } from "../utils/httpError";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { uploadMainPhotoToStorage } from "../services/adminMediaService";

function readFieldValue(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key] as { value?: unknown } | undefined;
  return String(raw?.value ?? "").trim();
}

export async function uploadMainPhotoHandler(request: FastifyRequest) {
  const adminToken = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(adminToken);

  const filePart = await request.file();
  if (!filePart) {
    throw new HttpError(400, "BAD_PAYLOAD", "file is required");
  }

  const fields = (filePart.fields ?? {}) as Record<string, unknown>;
  const postId = readFieldValue(fields, "post_id");
  const photoNoRaw = readFieldValue(fields, "photo_no");
  const itemIdRaw = readFieldValue(fields, "item_id");

  return uploadMainPhotoToStorage({
    file: filePart,
    postId,
    photoNo: Number(photoNoRaw),
    itemId: itemIdRaw ? Number(itemIdRaw) : null,
  });
}
