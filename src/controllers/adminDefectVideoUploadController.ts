import type { FastifyRequest } from "fastify";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import { createDefectVideoRecord } from "../services/adminDefectVideoUploadService";

function readFieldValue(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key] as { value?: unknown } | undefined;
  return String(raw?.value ?? "").trim();
}

export async function uploadDefectVideoHandler(request: FastifyRequest) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-upload",
    event: "defect_video_upload_route_hit",
    method: request.method,
    url: request.url,
  }));

  const token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(token);

  const filePart = await request.file({
    limits: {
      fileSize: env.adminDefectVideoUploadMaxBytes,
      files: 1,
    },
  });
  if (!filePart) {
    throw new HttpError(400, "BAD_PAYLOAD", "file is required");
  }

  const fields = (filePart.fields ?? {}) as Record<string, unknown>;
  const postId = readFieldValue(fields, "post_id");
  const photoNoRaw = readFieldValue(fields, "photo_no");
  const mimeTypeRaw = readFieldValue(fields, "mime_type");

  const result = await createDefectVideoRecord({
    file: filePart,
    postId,
    photoNo: Number(photoNoRaw),
    mimeTypeHint: mimeTypeRaw || null,
  });

  return result;
}

