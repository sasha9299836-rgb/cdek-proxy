import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

type CreateMeasurementPhotoInput = {
  post_id: string;
  photo_no: number;
  storage_key: string;
  media_type: "image" | "video";
};

const YC_STORAGE_ENDPOINT = "https://storage.yandexcloud.net";
const STORAGE_KEY_MEASUREMENT_IMAGE_REGEX = /^measurements\/([0-9a-f-]{36})\/([1-9]|[1-4]\d|50)\.(jpg|png|webp)$/i;
const STORAGE_KEY_MEASUREMENT_VIDEO_REGEX = /^measurements\/([0-9a-f-]{36})\/videos\/([1-9]|[1-4]\d|50)\.(mp4|mov)$/i;

let s3Client: S3Client | null = null;

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

function parsePostId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id must be UUID");
  }
  return value;
}

function parsePhotoNo(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no must be integer in range 1..50");
  }
  return n;
}

function parseStorageKey(raw: unknown): string {
  const key = String(raw ?? "").trim();
  if (!STORAGE_KEY_MEASUREMENT_IMAGE_REGEX.test(key) && !STORAGE_KEY_MEASUREMENT_VIDEO_REGEX.test(key)) {
    throw new HttpError(400, "BAD_PAYLOAD", "key is invalid for measurement photo");
  }
  return key;
}

function extractPhotoNoFromKey(key: string): number {
  const match = key.match(/\/([1-9]|[1-4]\d|50)\.(jpg|png|webp|mp4|mov)$/i);
  if (!match?.[1]) {
    throw new HttpError(400, "BAD_PAYLOAD", "Cannot parse photo_no from key");
  }
  return Number(match[1]);
}

function extractPostIdFromKey(key: string): string {
  const match = key.match(/^measurements\/([0-9a-f-]{36})\//i);
  if (!match?.[1]) {
    throw new HttpError(400, "BAD_PAYLOAD", "Cannot parse post_id from key");
  }
  return match[1];
}

function parseMediaType(raw: unknown, key: string): "image" | "video" {
  const explicit = String(raw ?? "").trim().toLowerCase();
  if (explicit === "image" || explicit === "video") return explicit;
  return STORAGE_KEY_MEASUREMENT_VIDEO_REGEX.test(key) ? "video" : "image";
}

function buildPublicUrlByKey(key: string): string {
  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
  }
  return `https://${bucket}.storage.yandexcloud.net/${key}`;
}

export async function createMeasurementPhotoRecord(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const photoNo = parsePhotoNo(row.photo_no);
  const storageKey = parseStorageKey(row.storage_key);
  const mediaType = parseMediaType(row.media_type, storageKey);
  const photoNoFromKey = extractPhotoNoFromKey(storageKey);
  if (photoNoFromKey !== photoNo) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no does not match key");
  }
  const postIdFromKey = extractPostIdFromKey(storageKey);
  if (postIdFromKey !== postId) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id does not match key");
  }

  const url = buildPublicUrlByKey(storageKey);
  const supabase = getSupabaseAdminClient();

  console.info(JSON.stringify({
    scope: "admin-measurement-photo",
    event: "measurement_photo_create_insert_start",
    post_id: postId,
    photo_no: photoNo,
    key: storageKey,
  }));

  const { data, error } = await supabase
    .from("tg_post_measurement_photos")
    .insert({
      post_id: postId,
      photo_no: photoNo,
      storage_key: storageKey,
      public_url: url,
      media_type: mediaType,
    } as CreateMeasurementPhotoInput & { public_url: string })
    .select("*")
    .single();

  if (error) {
    console.error(JSON.stringify({
      scope: "admin-measurement-photo",
      event: "measurement_photo_create_insert_error",
      post_id: postId,
      photo_no: photoNo,
      key: storageKey,
      db_message: error.message,
      db_code: error.code ?? null,
      db_details: error.details ?? null,
      db_hint: error.hint ?? null,
    }));
    throw new HttpError(500, "MEASUREMENT_PHOTO_CREATE_FAILED", "Failed to create measurement photo", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  console.info(JSON.stringify({
    scope: "admin-measurement-photo",
    event: "measurement_photo_create_insert_success",
    post_id: postId,
    photo_no: photoNo,
    key: storageKey,
    id: (data as { id?: string | number })?.id ?? null,
  }));

  return {
    ok: true as const,
    photo_no: photoNo,
    storage_key: storageKey,
    public_url: url,
    media_type: mediaType,
    photo: data,
  };
}

export async function deleteMeasurementMediaRecord(raw: unknown) {
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
      .from("tg_post_measurement_photos")
      .select("id, storage_key")
      .eq("id", parsedId)
      .maybeSingle();
    if (error) {
      throw new HttpError(500, "MEASUREMENT_PHOTO_LOOKUP_FAILED", "Failed to load measurement media", {
        message: error.message,
      });
    }
    if (!data) {
      throw new HttpError(404, "NOT_FOUND", "Measurement media not found");
    }
    targetKey = String((data as { storage_key?: string }).storage_key ?? "").trim();
  }

  if (!targetKey) {
    throw new HttpError(400, "BAD_PAYLOAD", "storage_key is required");
  }
  if (!STORAGE_KEY_MEASUREMENT_IMAGE_REGEX.test(targetKey) && !STORAGE_KEY_MEASUREMENT_VIDEO_REGEX.test(targetKey)) {
    throw new HttpError(400, "BAD_PAYLOAD", "storage_key is invalid for measurement media");
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
    throw new HttpError(502, "DELETE_FAILED", "Failed to delete measurement media from storage", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let deleteQuery = supabase.from("tg_post_measurement_photos").delete();
  if (targetId != null) {
    deleteQuery = deleteQuery.eq("id", targetId);
  } else {
    deleteQuery = deleteQuery.eq("storage_key", targetKey);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    throw new HttpError(500, "MEASUREMENT_PHOTO_DELETE_FAILED", "Failed to delete measurement media", {
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
