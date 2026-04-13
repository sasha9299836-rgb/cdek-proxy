import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";

const YC_STORAGE_ENDPOINT = "https://storage.yandexcloud.net";
const ALLOWED_MAIN_MIME_TO_EXT: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

let s3Client: S3Client | null = null;

type UploadMainPhotoInput = {
  file: MultipartFile;
  postId: string;
  itemId: number | null;
  photoNo: number;
  kind?: "main" | "measurement";
};

export type UploadMainPhotoResult = {
  ok: true;
  key: string;
  url: string;
  photo_no: number;
  already_exists?: boolean;
};

function getS3Client(): S3Client {
  if (!env.ycAccessKey || !env.ycSecretKey || !env.ycBucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Yandex storage env is not configured");
  }
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "storage_env_validated",
    has_bucket: Boolean(env.ycBucket),
    region: env.ycRegion || "ru-central1",
  }));
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.ycRegion || "ru-central1",
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

function parsePhotoNo(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no must be an integer from 1 to 50");
  }
  return parsed;
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
  const value = String(raw ?? "").trim();
  return value;
}

function isSafePostId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function resolveMainPhotoExt(mime: string): "jpg" | "png" | "webp" {
  const normalized = String(mime ?? "").trim().toLowerCase();
  const ext = ALLOWED_MAIN_MIME_TO_EXT[normalized];
  if (!ext) {
    throw new HttpError(400, "BAD_MIME_TYPE", "Only image/jpeg, image/png, image/webp are allowed for main photos");
  }
  return ext;
}

async function streamToBuffer(stream: NodeJS.ReadableStream, maxBytes: number): Promise<{ buffer: Buffer; size: number }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new HttpError(413, "FILE_TOO_LARGE", `File is too large. Max ${maxBytes} bytes allowed`);
    }
    chunks.push(buf);
  }
  return { buffer: Buffer.concat(chunks), size: total };
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  const client = getS3Client();
  try {
    await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) return false;
    const name = String((error as { name?: unknown })?.name ?? "");
    if (name === "NotFound" || name === "NoSuchKey") return false;
    throw new HttpError(502, "STORAGE_CHECK_FAILED", "Failed to check existing object", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function uploadMainPhotoToStorage(input: UploadMainPhotoInput): Promise<UploadMainPhotoResult> {
  const photoNo = parsePhotoNo(input.photoNo);
  const itemId = parseItemId(input.itemId);
  const postId = parsePostId(input.postId);
  const kind = input.kind === "measurement" ? "measurement" : "main";
  if (kind === "measurement" && !isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for measurement uploads");
  }
  if (kind === "main" && itemId == null && !isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for no-item uploads");
  }

  const mime = String(input.file.mimetype ?? "").trim().toLowerCase();
  const ext = resolveMainPhotoExt(mime);
  const maxBytes = Math.max(1, env.adminMainUploadMaxBytes);
  const { buffer, size } = await streamToBuffer(input.file.file, maxBytes);

  const bucket = env.ycBucket;
  const basePrefix = kind === "measurement"
    ? `measurements/${postId}`
    : itemId
    ? `${itemId}`
    : `no-item/${postId}`;
  const key = `${basePrefix}/${photoNo}.${ext}`;
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_upload_key_resolved",
    post_id: postId || null,
    item_id: itemId,
    photo_no: photoNo,
    key,
    mime,
    kind,
  }));

  if (await objectExists(bucket, key)) {
    if (kind === "measurement" || itemId != null) {
      const url = `https://${bucket}.storage.yandexcloud.net/${key}`;
      console.info(JSON.stringify({
        scope: "admin-media",
        event: "main_upload_already_exists_handled",
        post_id: postId || null,
        photo_no: photoNo,
        item_id: itemId,
        key,
        kind,
      }));
      return {
        ok: true,
        already_exists: true,
        key,
        url,
        photo_no: photoNo,
      };
    }
    throw new HttpError(409, "ALREADY_EXISTS", "Main photo with this photo_no already exists");
  }

  const client = getS3Client();
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
    }));
  } catch (error) {
    throw new HttpError(502, "UPLOAD_FAILED", "Failed to upload file to storage", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const url = `https://${bucket}.storage.yandexcloud.net/${key}`;
  console.info(JSON.stringify({
    scope: "admin-media",
    event: "main_photo_uploaded",
    post_id: postId || null,
    photo_no: photoNo,
    item_id: itemId,
    mime,
    size,
    key,
    kind,
  }));

  return {
    ok: true,
    key,
    url,
    photo_no: photoNo,
  };
}
