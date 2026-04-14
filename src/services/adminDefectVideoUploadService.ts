import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

const YC_STORAGE_ENDPOINT = "https://storage.yandexcloud.net";
const ALLOWED_VIDEO_MIME_TO_EXT: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-quicktime": "mov",
  "video/mov": "mov",
  "quicktime": "mov",
};

let s3Client: S3Client | null = null;

type CreateDefectVideoInput = {
  file: MultipartFile;
  postId: string;
  photoNo: number;
  mimeTypeHint: string | null;
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
    s3Client.middlewareStack.add(
      (next) => async (args) => {
        const request = args.request as { headers?: Record<string, unknown> } | undefined;
        const headers = request?.headers;
        if (headers) {
          const badHeaderKeys = Object.keys(headers).filter((key) => key.toLowerCase() === "x-amz-decoded-content-length");
          for (const key of badHeaderKeys) {
            const raw = headers[key];
            if (raw == null || String(raw).trim().toLowerCase() === "undefined" || String(raw).trim() === "") {
              delete headers[key];
            }
          }
        }
        return next(args);
      },
      {
        step: "build",
        name: "stripInvalidDecodedContentLengthHeader",
        priority: "high",
      },
    );
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

function buildStorageKey(postId: string, photoNo: number): string {
  return `no-item/${postId}/defects/videos/${photoNo}.mov`;
}

export async function createDefectVideoRecord(input: CreateDefectVideoInput) {
  const postId = parsePostId(input.postId);
  const photoNo = parsePhotoNo(input.photoNo);
  if (!isSafePostId(postId)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required for defect video uploads");
  }

  const mime = String(input.file.mimetype ?? input.mimeTypeHint ?? "").trim().toLowerCase();
  resolveVideoExt(mime);
  const key = buildStorageKey(postId, photoNo);
  const bucket = String(env.ycBucket ?? "").trim();
  if (!bucket) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "YC_BUCKET is not configured");
  }

  const client = getS3Client();
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.file.file,
      ContentType: mime,
    }));
  } catch (error) {
    throw new HttpError(502, "UPLOAD_FAILED", "Failed to upload defect video to storage", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const publicUrl = `https://${bucket}.storage.yandexcloud.net/${key}`;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tg_post_defect_photos")
    .insert({
      post_id: postId,
      photo_no: photoNo,
      storage_key: key,
      public_url: publicUrl,
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

  return {
    ok: true as const,
    id: (data as { id?: number })?.id ?? null,
    photo_no: photoNo,
    storage_key: key,
    public_url: publicUrl,
    media_type: "video" as const,
  };
}
