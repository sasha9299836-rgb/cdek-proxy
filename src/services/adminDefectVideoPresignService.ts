import crypto from "node:crypto";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";

const SERVICE = "s3";
const DEFAULT_REGION = "ru-central1";

const ALLOWED_VIDEO_MIME_TO_EXT: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-quicktime": "mov",
  "video/mov": "mov",
  "quicktime": "mov",
};

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
}): string {
  const { method, host, key, accessKey, secretKey, region, expiresSeconds } = input;
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

export async function presignDefectVideo(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const itemId = parseItemId(row.item_id);
  const photoNo = parsePhotoNo(row.photo_no);
  const mime = String(row.mime ?? "").trim().toLowerCase();
  const ext = resolveVideoExt(mime);

  if (itemId == null && !isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for no-item uploads");
  }

  const accessKey = String(env.ycAccessKey ?? "").trim();
  const secretKey = String(env.ycSecretKey ?? "").trim();
  const bucket = String(env.ycBucket ?? "").trim();
  const region = String(env.ycRegion ?? "").trim() || DEFAULT_REGION;
  if (!accessKey || !secretKey || !bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Yandex storage env is not configured");
  }

  const basePrefix = itemId ? `${itemId}` : `no-item/${postId}`;
  const key = `${basePrefix}/defects/videos/${photoNo}.${ext}`;
  const host = `${bucket}.storage.yandexcloud.net`;
  const publicUrl = `https://${host}/${key}`;

  const presignedUrl = createPresignedUrl({
    method: "PUT",
    host,
    key,
    accessKey,
    secretKey,
    region,
    expiresSeconds: "300",
  });

  return {
    ok: true as const,
    presigned_url: presignedUrl,
    storage_key: key,
    public_url: publicUrl,
    photo_no: photoNo,
  };
}
