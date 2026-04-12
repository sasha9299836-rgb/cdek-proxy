import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

type CreatePostPhotoInput = {
  post_id: string;
  photo_no: number;
  key: string;
};

const STORAGE_KEY_MAIN_REGEX = /^(\d+|no-item\/[0-9a-f-]{36})\/([1-9]|1\d|20)\.(jpg|png|webp)$/i;

function parsePhotoNo(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no must be integer in range 1..20");
  }
  return n;
}

function parsePostId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id must be UUID");
  }
  return value;
}

function parseStorageKey(raw: unknown): string {
  const key = String(raw ?? "").trim();
  if (!STORAGE_KEY_MAIN_REGEX.test(key)) {
    throw new HttpError(400, "BAD_PAYLOAD", "key is invalid for main photo");
  }
  return key;
}

function extractPhotoNoFromKey(key: string): number {
  const match = key.match(/\/([1-9]|1\d|20)\.(jpg|png|webp)$/i);
  if (!match?.[1]) {
    throw new HttpError(400, "BAD_PAYLOAD", "Cannot parse photo_no from key");
  }
  return Number(match[1]);
}

function deriveItemIdFromKey(key: string): number | null {
  const match = key.match(/^(\d+)\//);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function buildPublicUrlByKey(key: string): string {
  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
  }
  return `https://${bucket}.storage.yandexcloud.net/${key}`;
}

export async function createPostPhotoRecord(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const photoNo = parsePhotoNo(row.photo_no);
  const storageKey = parseStorageKey(row.key);
  const photoNoFromKey = extractPhotoNoFromKey(storageKey);
  if (photoNoFromKey !== photoNo) {
    throw new HttpError(400, "BAD_PAYLOAD", "photo_no does not match key");
  }

  const itemId = deriveItemIdFromKey(storageKey);
  const url = buildPublicUrlByKey(storageKey);
  const supabase = getSupabaseAdminClient();

  console.info(JSON.stringify({
    scope: "admin-post-photo",
    event: "post_photo_create_insert_start",
    post_id: postId,
    photo_no: photoNo,
    item_id: itemId,
    key: storageKey,
  }));

  const { data, error } = await supabase
    .from("tg_post_photos")
    .insert({
      post_id: postId,
      item_id: itemId,
      photo_no: photoNo,
      storage_key: storageKey,
      url,
      kind: "main",
      sort_order: photoNo - 1,
    })
    .select("*")
    .single();

  if (error) {
    console.error(JSON.stringify({
      scope: "admin-post-photo",
      event: "post_photo_create_insert_error",
      post_id: postId,
      photo_no: photoNo,
      key: storageKey,
      db_message: error.message,
      db_code: error.code ?? null,
      db_details: error.details ?? null,
      db_hint: error.hint ?? null,
    }));
    throw new HttpError(500, "POST_PHOTO_CREATE_FAILED", "Failed to create post photo", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  console.info(JSON.stringify({
    scope: "admin-post-photo",
    event: "post_photo_create_insert_success",
    post_id: postId,
    photo_no: photoNo,
    key: storageKey,
    id: (data as { id?: string })?.id ?? null,
  }));

  return {
    ok: true as const,
    photo_no: photoNo,
    key: storageKey,
    photo: data,
  };
}
