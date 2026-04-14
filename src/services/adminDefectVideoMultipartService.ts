import crypto from "node:crypto";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";

const SERVICE = "s3";
const DEFAULT_REGION = "ru-central1";
const YC_STORAGE_ENDPOINT = "https://storage.yandexcloud.net";
const MIN_PART_SIZE = 1 * 1024 * 1024;
const DEFAULT_PART_SIZE = 1 * 1024 * 1024;
const MAX_PARTS = 10000;

const ALLOWED_VIDEO_MIME_TO_EXT: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-quicktime": "mov",
  "video/mov": "mov",
  "quicktime": "mov",
};

let s3Client: S3Client | null = null;

type PartDescriptor = {
  part_number: number;
  url: string;
};

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

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function getIsoNow(date: Date) {
  const y = date.getUTCFullYear().toString();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  return {
    dateStamp: `${y}${m}${d}`,
    amzDate: `${y}${m}${d}T${hh}${mm}${ss}Z`,
  };
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmacSha256Raw(key: Buffer, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function getSigningKey(secretKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256Raw(Buffer.from(`AWS4${secretKey}`, "utf8"), dateStamp);
  const kRegion = hmacSha256Raw(kDate, region);
  const kService = hmacSha256Raw(kRegion, SERVICE);
  return hmacSha256Raw(kService, "aws4_request");
}

function createCanonicalQueryString(queryParams: URLSearchParams): string {
  return [...queryParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");
}

function createPresignedUrl(input: {
  method: "PUT";
  host: string;
  key: string;
  accessKey: string;
  secretKey: string;
  region: string;
  expiresSeconds: string;
  extraQuery?: Record<string, string>;
}): string {
  const { method, host, key, accessKey, secretKey, region, expiresSeconds, extraQuery } = input;
  const encodedKeyPath = key.split("/").map(encodeRfc3986).join("/");
  const canonicalUri = `/${encodedKeyPath}`;

  const now = new Date();
  const { dateStamp, amzDate } = getIsoNow(now);
  const signedHeaders = "host";
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": expiresSeconds,
    "X-Amz-SignedHeaders": signedHeaders,
  });

  if (extraQuery) {
    for (const [keyName, value] of Object.entries(extraQuery)) {
      queryParams.set(keyName, value);
    }
  }

  const canonicalQueryString = createCanonicalQueryString(queryParams);
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const signingKey = getSigningKey(secretKey, dateStamp, region);
  const signature = hmacSha256Raw(signingKey, stringToSign).toString("hex");

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function parsePhotoNo(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no must be integer in range 1..50");
  }
  return n;
}

function parseItemId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "BAD_PAYLOAD", "item_id must be a positive integer");
  }
  return parsed;
}

function parsePostId(raw: unknown): string {
  return String(raw ?? "").trim();
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

function parseFileSize(raw: unknown): number {
  const size = Number(raw);
  if (!Number.isFinite(size) || size <= 0) {
    throw new HttpError(400, "BAD_PAYLOAD", "file_size must be a positive number");
  }
  return size;
}

function computePartSize(fileSize: number): number {
  let partSize = DEFAULT_PART_SIZE;
  if (Math.ceil(fileSize / partSize) > MAX_PARTS) {
    partSize = Math.ceil(fileSize / MAX_PARTS);
  }
  if (partSize < MIN_PART_SIZE) partSize = MIN_PART_SIZE;
  if (Math.ceil(fileSize / partSize) > MAX_PARTS) {
    throw new HttpError(400, "FILE_TOO_LARGE", "File requires too many parts for multipart upload");
  }
  return partSize;
}

function resolveStorageKey(input: {
  postId: string;
  photoNo: number;
  ext: "mp4" | "mov";
}): string {
  const basePrefix = `no-item/${input.postId}`;
  return `${basePrefix}/defects/videos/${input.photoNo}.${input.ext}`;
}

function validateStorageKeyMatchesPostId(storageKey: string, postId: string) {
  if (storageKey.startsWith("no-item/")) {
    const prefix = `no-item/${postId}/`;
    if (!storageKey.startsWith(prefix)) {
      throw new HttpError(400, "BAD_PAYLOAD", "post_id does not match storage_key");
    }
  }
}

export async function startDefectVideoMultipart(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const itemId = parseItemId(row.item_id);
  const photoNo = parsePhotoNo(row.photo_no);
  const mime = String(row.mime ?? "").trim().toLowerCase();
  const fileSize = parseFileSize(row.file_size);
  const ext = resolveVideoExt(mime);

  if (!isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for defect video uploads");
  }

  const accessKey = String(env.ycAccessKey ?? "").trim();
  const secretKey = String(env.ycSecretKey ?? "").trim();
  const bucket = String(env.ycBucket ?? "").trim();
  const region = String(env.ycRegion ?? "").trim() || DEFAULT_REGION;
  if (!accessKey || !secretKey || !bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Yandex storage env is not configured");
  }

  const key = resolveStorageKey({ postId, photoNo, ext });
  const host = `${bucket}.storage.yandexcloud.net`;
  const publicUrl = `https://${host}/${key}`;

  const client = getS3Client();
  const createResult = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mime,
  }));
  const uploadId = String(createResult.UploadId ?? "").trim();
  if (!uploadId) {
    throw new HttpError(500, "MULTIPART_CREATE_FAILED", "Failed to create multipart upload");
  }

  const partSize = computePartSize(fileSize);
  const partsCount = Math.ceil(fileSize / partSize);
  const parts: PartDescriptor[] = [];
  for (let partNumber = 1; partNumber <= partsCount; partNumber += 1) {
    const url = createPresignedUrl({
      method: "PUT",
      host,
      key,
      accessKey,
      secretKey,
      region,
      expiresSeconds: "900",
      extraQuery: {
        partNumber: String(partNumber),
        uploadId,
      },
    });
    parts.push({ part_number: partNumber, url });
  }

  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_start_created",
    post_id: postId || null,
    item_id: itemId,
    photo_no: photoNo,
    upload_id: uploadId,
    parts: parts.length,
    part_size: partSize,
    key,
    key_strategy: "no-item-post-id",
  }));

  return {
    ok: true as const,
    upload_id: uploadId,
    storage_key: key,
    public_url: publicUrl,
    part_size: partSize,
    parts,
    photo_no: photoNo,
  };
}

export async function completeDefectVideoMultipart(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const uploadId = String(row.upload_id ?? "").trim();
  const storageKey = String(row.storage_key ?? "").trim();
  if (!uploadId) {
    throw new HttpError(400, "BAD_PAYLOAD", "upload_id is required");
  }
  if (!storageKey) {
    throw new HttpError(400, "BAD_PAYLOAD", "storage_key is required");
  }
  if (!isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required");
  }
  validateStorageKeyMatchesPostId(storageKey, postId);

  const rawParts = Array.isArray(row.parts) ? row.parts : [];
  const parts = rawParts.map((entry) => ({
    PartNumber: Number((entry as { PartNumber?: unknown }).PartNumber ?? (entry as { partNumber?: unknown }).partNumber ?? 0),
    ETag: String((entry as { ETag?: unknown }).ETag ?? (entry as { etag?: unknown }).etag ?? "").trim(),
  })).filter((entry) => Number.isInteger(entry.PartNumber) && entry.PartNumber > 0 && entry.ETag);

  if (!parts.length) {
    throw new HttpError(400, "BAD_PAYLOAD", "parts must include PartNumber and ETag");
  }

  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Yandex storage env is not configured");
  }

  const client = getS3Client();
  try {
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: storageKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    }));
  } catch (error) {
    throw new HttpError(502, "MULTIPART_COMPLETE_FAILED", "Failed to complete multipart upload", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  console.info(JSON.stringify({
    scope: "admin-defect-video-multipart",
    event: "defect_video_multipart_complete_success",
    post_id: postId || null,
    storage_key: storageKey,
    upload_id: uploadId,
    parts: parts.length,
  }));

  return {
    ok: true as const,
    storage_key: storageKey,
  };
}
