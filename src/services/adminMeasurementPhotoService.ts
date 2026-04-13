import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

type CreateMeasurementPhotoInput = {
  post_id: string;
  photo_no: number;
  storage_key: string;
};

const STORAGE_KEY_MEASUREMENT_REGEX = /^measurements\/[0-9a-f-]{36}\/([1-9]|[1-4]\d|50)\.(jpg|png|webp)$/i;

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
  if (!STORAGE_KEY_MEASUREMENT_REGEX.test(key)) {
    throw new HttpError(400, "BAD_PAYLOAD", "key is invalid for measurement photo");
  }
  return key;
}

function extractPhotoNoFromKey(key: string): number {
  const match = key.match(/\/([1-9]|[1-4]\d|50)\.(jpg|png|webp)$/i);
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
    photo: data,
  };
}
