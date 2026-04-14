import type { FastifyRequest } from "fastify";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { readAdminTokenFromHeaders, requireValidAdminSession } from "../services/adminSession";
import {
  abortDefectVideoRelayUpload,
  completeDefectVideoRelayUpload,
  startDefectVideoRelayUpload,
  uploadDefectVideoRelayPart,
} from "../services/adminDefectVideoRelayService";

function readFieldValue(fields: Record<string, unknown>, key: string): string {
  const raw = fields[key] as { value?: unknown } | undefined;
  return String(raw?.value ?? "").trim();
}

async function requireAuth(request: FastifyRequest) {
  const token = readAdminTokenFromHeaders(request.headers as Record<string, unknown>);
  await requireValidAdminSession(token);
}

export async function startDefectVideoRelayHandler(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_start_route_hit",
    method: request.method,
    url: request.url,
  }));
  await requireAuth(request);
  return startDefectVideoRelayUpload(request.body ?? {});
}

export async function uploadDefectVideoRelayPartHandler(request: FastifyRequest) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_part_route_hit",
    method: request.method,
    url: request.url,
  }));
  await requireAuth(request);

  const filePart = await request.file({
    limits: {
      fileSize: Math.min(env.adminDefectVideoUploadMaxBytes, 8 * 1024 * 1024),
      files: 1,
    },
  });
  if (!filePart) {
    throw new HttpError(400, "BAD_PAYLOAD", "chunk file is required");
  }
  const fields = (filePart.fields ?? {}) as Record<string, unknown>;
  const sessionId = readFieldValue(fields, "session_id");
  const partNumber = readFieldValue(fields, "part_number");

  return uploadDefectVideoRelayPart({
    session_id: sessionId,
    part_number: Number(partNumber),
    stream: filePart.file,
  });
}

export async function completeDefectVideoRelayHandler(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_complete_route_hit",
    method: request.method,
    url: request.url,
  }));
  await requireAuth(request);
  return completeDefectVideoRelayUpload(request.body ?? {});
}

export async function abortDefectVideoRelayHandler(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
) {
  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_abort_route_hit",
    method: request.method,
    url: request.url,
  }));
  await requireAuth(request);
  return abortDefectVideoRelayUpload(request.body ?? {});
}

