import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

const YC_STORAGE_ENDPOINT = "https://storage.yandexcloud.net";

const ALLOWED_IMAGE_MIME_TO_EXT: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ALLOWED_VIDEO_MIME_TO_EXT: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-quicktime": "mov",
  "video/mov": "mov",
  "quicktime": "mov",
};

const DEFECT_STORAGE_KEY_IMAGE_REGEX = /^(\d+|no-item\/[0-9a-f-]{36})\/defects\/images\/([1-9]|[1-4]\d|50)\.(jpg|png|webp)$/i;
const DEFECT_STORAGE_KEY_VIDEO_REGEX = /^(\d+|no-item\/[0-9a-f-]{36})\/defects\/videos\/([1-9]|[1-4]\d|50)\.(mp4|mov)$/i;
const DEFECT_STORAGE_KEY_LEGACY_REGEX = /^(\d+|no-item\/[0-9a-f-]{36})\/defects\/([1-9]|[1-4]\d|50)\.(jpg|png|webp)$/i;

let s3Client: S3Client | null = null;

type CreateDefectPhotoInput = {
  file: MultipartFile;
  postId: string;
  itemId: number | null;
  photoNo: number;
  mediaType: string;
};

function getS3Client(): S3Client {
  if (!env.ycAccessKey || !env.ycSecretKey || !env.ycBucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Yandex storage env is not configured");
  }
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

function parseMediaType(raw: unknown): "image" | "video" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "image" || value === "video") return value;
  throw new HttpError(400, "BAD_PAYLOAD", "media_type must be image or video");
}

function resolveExtForMedia(mime: string, mediaType: "image" | "video"): "jpg" | "png" | "webp" | "mp4" | "mov" {
  const normalized = String(mime ?? "").trim().toLowerCase();
  if (mediaType === "image") {
    const ext = ALLOWED_IMAGE_MIME_TO_EXT[normalized];
    if (!ext) {
      throw new HttpError(400, "BAD_MIME_TYPE", "Only image/jpeg, image/png, image/webp are allowed for defect images");
    }
    return ext;
  }
  const ext = ALLOWED_VIDEO_MIME_TO_EXT[normalized];
  if (!ext) {
    throw new HttpError(400, "BAD_MIME_TYPE", "Only video/mp4 or video/quicktime are allowed for defect videos");
  }
  return ext;
}

function buildStorageKey(params: {
  itemId: number | null;
  postId: string;
  photoNo: number;
  mediaType: "image" | "video";
  ext: string;
}): string {
  const basePrefix = params.itemId ? `${params.itemId}` : `no-item/${params.postId}`;
  const folder = params.mediaType === "video" ? "videos" : "images";
  return `${basePrefix}/defects/${folder}/${params.photoNo}.${params.ext}`;
}

function buildPublicUrlByKey(key: string): string {
  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
  }
  return `https://${bucket}.storage.yandexcloud.net/${key}`;
}

function isAllowedDefectStorageKey(key: string): boolean {
  return DEFECT_STORAGE_KEY_IMAGE_REGEX.test(key)
    || DEFECT_STORAGE_KEY_VIDEO_REGEX.test(key)
    || DEFECT_STORAGE_KEY_LEGACY_REGEX.test(key);
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

export async function createDefectPhotoRecord(input: CreateDefectPhotoInput) {
  const photoNo = parsePhotoNo(input.photoNo);
  const itemId = parseItemId(input.itemId);
  const postId = parsePostId(input.postId);
  const mediaType = parseMediaType(input.mediaType);
  if (itemId == null && !isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for no-item uploads");
  }

  const mime = String(input.file.mimetype ?? "").trim().toLowerCase();
  const ext = resolveExtForMedia(mime, mediaType);
  const maxBytes = Math.max(1, env.adminMainUploadMaxBytes);
  const { buffer, size } = await streamToBuffer(input.file.file, maxBytes);

  const key = buildStorageKey({
    itemId,
    postId,
    photoNo,
    mediaType,
    ext,
  });
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_key_resolved",
    post_id: postId || null,
    item_id: itemId,
    photo_no: photoNo,
    key,
    mime,
    media_type: mediaType,
  }));

  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
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
    throw new HttpError(502, "UPLOAD_FAILED", "Failed to upload defect media to storage", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const url = buildPublicUrlByKey(key);
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_uploaded",
    post_id: postId || null,
    photo_no: photoNo,
    item_id: itemId,
    mime,
    size,
    key,
    media_type: mediaType,
  }));

  const supabase = getSupabaseAdminClient();
  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_insert_start",
    post_id: postId || null,
    photo_no: photoNo,
    key,
    media_type: mediaType,
  }));
  const { data, error } = await supabase
    .from("tg_post_defect_photos")
    .insert({
      post_id: postId,
      photo_no: photoNo,
      storage_key: key,
      public_url: url,
      media_type: mediaType,
    })
    .select("*")
    .single();

  if (error) {
    console.error(JSON.stringify({
      scope: "admin-defect-photo",
      event: "defect_photo_insert_error",
      post_id: postId || null,
      photo_no: photoNo,
      key,
      db_message: error.message,
      db_code: error.code ?? null,
      db_details: error.details ?? null,
      db_hint: error.hint ?? null,
    }));
    throw new HttpError(500, "DEFECT_PHOTO_CREATE_FAILED", "Failed to create defect photo", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  console.info(JSON.stringify({
    scope: "admin-defect-photo",
    event: "defect_photo_insert_success",
    post_id: postId || null,
    photo_no: photoNo,
    key,
    id: (data as { id?: number })?.id ?? null,
  }));

  return {
    ok: true as const,
    id: (data as { id?: number })?.id ?? null,
    photo_no: photoNo,
    storage_key: key,
    public_url: url,
    media_type: mediaType,
  };
}

export async function deleteDefectPhotoRecord(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const idRaw = row.id;
  const storageKeyRaw = String(row.storage_key ?? "").trim();

  const supabase = getSupabaseAdminClient();

  let targetId: number | null = null;
  let targetKey = storageKeyRaw;
  if (idRaw != null && String(idRaw).trim() !== "") {
    const parsedId = Number(idRaw);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new HttpError(400, "BAD_PAYLOAD", "id must be positive integer");
    }
    targetId = parsedId;
    const { data, error } = await supabase
      .from("tg_post_defect_photos")
      .select("id, storage_key")
      .eq("id", parsedId)
      .maybeSingle();
    if (error) {
      throw new HttpError(500, "DEFECT_PHOTO_LOOKUP_FAILED", "Failed to load defect photo", {
        message: error.message,
      });
    }
    if (!data) {
      throw new HttpError(404, "NOT_FOUND", "Defect photo not found");
    }
    targetKey = String((data as { storage_key?: string }).storage_key ?? "").trim();
  }

  if (!targetKey) {
    throw new HttpError(400, "BAD_PAYLOAD", "storage_key is required");
  }
  if (!isAllowedDefectStorageKey(targetKey)) {
    throw new HttpError(400, "BAD_PAYLOAD", "storage_key is invalid for defect media");
  }

  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
  }

  const client = getS3Client();
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: targetKey,
    }));
  } catch (error) {
    throw new HttpError(502, "DELETE_FAILED", "Failed to delete defect media from storage", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let deleteQuery = supabase.from("tg_post_defect_photos").delete();
  if (targetId != null) {
    deleteQuery = deleteQuery.eq("id", targetId);
  } else {
    deleteQuery = deleteQuery.eq("storage_key", targetKey);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    throw new HttpError(500, "DEFECT_PHOTO_DELETE_FAILED", "Failed to delete defect photo", {
      message: deleteError.message,
      code: deleteError.code ?? null,
    });
  }

  return {
    ok: true as const,
    id: targetId,
    storage_key: targetKey,
  };
}
