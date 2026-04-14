import crypto from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

const YC_STORAGE_ENDPOINT = "https://storage.yandexcloud.net";
const DEFAULT_REGION = "ru-central1";
const RELAY_PART_SIZE_BYTES = 1 * 1024 * 1024;
const RELAY_PART_MAX_BYTES = 8 * 1024 * 1024;
const RELAY_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const ALLOWED_VIDEO_MIME_TO_EXT: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-quicktime": "mov",
  "video/mov": "mov",
  quicktime: "mov",
};

type RelaySession = {
  sessionId: string;
  postId: string;
  photoNo: number;
  mime: string;
  fileSize: number;
  bucket: string;
  key: string;
  publicUrl: string;
  uploadId: string;
  createdAt: number;
  parts: Map<number, string>;
};

let s3Client: S3Client | null = null;
const relaySessions = new Map<string, RelaySession>();

function getS3Client(): S3Client {
  if (!env.ycAccessKey || !env.ycSecretKey || !env.ycBucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Yandex storage env is not configured");
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.ycRegion || DEFAULT_REGION,
      endpoint: YC_STORAGE_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.ycAccessKey,
        secretAccessKey: env.ycSecretKey,
      },
    });
  }
  return s3Client;
}

function cleanupExpiredRelaySessions() {
  const now = Date.now();
  for (const [sessionId, session] of relaySessions) {
    if (now - session.createdAt > RELAY_SESSION_TTL_MS) {
      relaySessions.delete(sessionId);
    }
  }
}

function parsePhotoNo(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no must be integer in range 1..50");
  }
  return n;
}

function parsePartNumber(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    throw new HttpError(400, "BAD_PAYLOAD", "part_number must be integer in range 1..10000");
  }
  return n;
}

function parseFileSize(raw: unknown): number {
  const size = Number(raw);
  if (!Number.isFinite(size) || size <= 0) {
    throw new HttpError(400, "BAD_PAYLOAD", "file_size must be a positive number");
  }
  return size;
}

function parsePostId(raw: unknown): string {
  return String(raw ?? "").trim();
}

function parseSessionId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    throw new HttpError(400, "BAD_PAYLOAD", "session_id is required");
  }
  return value;
}

function isSafePostId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function resolveVideoExt(mime: string): "mp4" | "mov" {
  const normalized = String(mime ?? "").trim().toLowerCase();
  const ext = ALLOWED_VIDEO_MIME_TO_EXT[normalized];
  if (!ext) {
    throw new HttpError(400, "BAD_MIME_TYPE", "Only video/mp4 or video/quicktime are allowed");
  }
  return ext;
}

function buildStorageKey(postId: string, photoNo: number): string {
  return `no-item/${postId}/defects/videos/${photoNo}.mov`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<{ buffer: Buffer; size: number }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new HttpError(413, "FILE_TOO_LARGE", `Chunk is too large. Max ${maxBytes} bytes allowed`);
    }
    chunks.push(buf);
  }
  return { buffer: Buffer.concat(chunks), size: total };
}

export async function startDefectVideoRelayUpload(raw: unknown) {
  cleanupExpiredRelaySessions();
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const photoNo = parsePhotoNo(row.photo_no);
  const mime = String(row.mime ?? "").trim().toLowerCase();
  const fileSize = parseFileSize(row.file_size);
  resolveVideoExt(mime);

  if (!isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for defect video uploads");
  }

  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
  }

  const key = buildStorageKey(postId, photoNo);
  const publicUrl = `https://${bucket}.storage.yandexcloud.net/${key}`;
  const client = getS3Client();
  const createResult = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mime,
  }));
  const uploadId = String(createResult.UploadId ?? "").trim();
  if (!uploadId) {
    throw new HttpError(500, "MULTIPART_CREATE_FAILED", "Failed to create relay multipart upload");
  }

  const sessionId = crypto.randomUUID();
  relaySessions.set(sessionId, {
    sessionId,
    postId,
    photoNo,
    mime,
    fileSize,
    bucket,
    key,
    publicUrl,
    uploadId,
    createdAt: Date.now(),
    parts: new Map<number, string>(),
  });

  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_start_success",
    session_id: sessionId,
    post_id: postId,
    photo_no: photoNo,
    file_size: fileSize,
    part_size: RELAY_PART_SIZE_BYTES,
    key,
  }));

  return {
    ok: true as const,
    session_id: sessionId,
    post_id: postId,
    photo_no: photoNo,
    storage_key: key,
    public_url: publicUrl,
    part_size: RELAY_PART_SIZE_BYTES,
  };
}

export async function uploadDefectVideoRelayPart(raw: {
  session_id: unknown;
  part_number: unknown;
  stream: NodeJS.ReadableStream;
}) {
  cleanupExpiredRelaySessions();
  const sessionId = parseSessionId(raw.session_id);
  const partNumber = parsePartNumber(raw.part_number);
  const session = relaySessions.get(sessionId);
  if (!session) {
    throw new HttpError(404, "RELAY_SESSION_NOT_FOUND", "Relay upload session not found");
  }

  const existingEtag = session.parts.get(partNumber);
  if (existingEtag) {
    return {
      ok: true as const,
      session_id: sessionId,
      part_number: partNumber,
      etag: existingEtag,
      already_uploaded: true,
    };
  }

  const { buffer, size } = await streamToBuffer(raw.stream, RELAY_PART_MAX_BYTES);
  const client = getS3Client();
  const result = await client.send(new UploadPartCommand({
    Bucket: session.bucket,
    Key: session.key,
    UploadId: session.uploadId,
    PartNumber: partNumber,
    Body: buffer,
    ContentLength: size,
  }));
  const etag = String(result.ETag ?? "").trim();
  if (!etag) {
    throw new HttpError(502, "RELAY_PART_UPLOAD_FAILED", "Storage did not return ETag for part");
  }

  session.parts.set(partNumber, etag);
  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_part_success",
    session_id: sessionId,
    part_number: partNumber,
    chunk_size: size,
    uploaded_parts: session.parts.size,
  }));

  return {
    ok: true as const,
    session_id: sessionId,
    part_number: partNumber,
    etag,
    chunk_size: size,
  };
}

export async function completeDefectVideoRelayUpload(raw: unknown) {
  cleanupExpiredRelaySessions();
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const sessionId = parseSessionId(row.session_id);
  const session = relaySessions.get(sessionId);
  if (!session) {
    throw new HttpError(404, "RELAY_SESSION_NOT_FOUND", "Relay upload session not found");
  }
  if (!session.parts.size) {
    throw new HttpError(400, "BAD_PAYLOAD", "No uploaded parts in relay session");
  }

  const sortedParts = [...session.parts.entries()]
    .map(([PartNumber, ETag]) => ({ PartNumber, ETag }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  const client = getS3Client();
  try {
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: session.bucket,
      Key: session.key,
      UploadId: session.uploadId,
      MultipartUpload: { Parts: sortedParts },
    }));
  } catch (error) {
    throw new HttpError(502, "RELAY_COMPLETE_FAILED", "Failed to complete relay multipart upload", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tg_post_defect_photos")
    .insert({
      post_id: session.postId,
      photo_no: session.photoNo,
      storage_key: session.key,
      public_url: session.publicUrl,
      media_type: "video",
    })
    .select("*")
    .single();
  if (error) {
    throw new HttpError(500, "DEFECT_VIDEO_CREATE_FAILED", "Failed to create defect video", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  relaySessions.delete(sessionId);
  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_complete_success",
    session_id: sessionId,
    post_id: session.postId,
    photo_no: session.photoNo,
    key: session.key,
  }));

  return {
    ok: true as const,
    session_id: sessionId,
    id: (data as { id?: number })?.id ?? null,
    post_id: session.postId,
    photo_no: session.photoNo,
    storage_key: session.key,
    public_url: session.publicUrl,
    media_type: "video" as const,
  };
}

export async function abortDefectVideoRelayUpload(raw: unknown) {
  cleanupExpiredRelaySessions();
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const sessionId = parseSessionId(row.session_id);
  const session = relaySessions.get(sessionId);
  if (!session) {
    return { ok: true as const, session_id: sessionId };
  }

  const client = getS3Client();
  try {
    await client.send(new AbortMultipartUploadCommand({
      Bucket: session.bucket,
      Key: session.key,
      UploadId: session.uploadId,
    }));
  } catch (error) {
    throw new HttpError(502, "RELAY_ABORT_FAILED", "Failed to abort relay multipart upload", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    relaySessions.delete(sessionId);
  }

  console.info(JSON.stringify({
    scope: "admin-defect-video-relay",
    event: "relay_abort_success",
    session_id: sessionId,
    post_id: session.postId,
    key: session.key,
  }));

  return {
    ok: true as const,
    session_id: sessionId,
  };
}

