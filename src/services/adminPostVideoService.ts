import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

function parsePostId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id is required");
  }
  return value;
}

function parseVideoUrl(raw: unknown): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "BAD_PAYLOAD", "video_url must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new HttpError(400, "BAD_PAYLOAD", "video_url must use https");
  }
  return parsed.toString();
}

export async function updateAdminPostVideoUrl(input: { post_id?: unknown; video_url?: unknown }) {
  const postId = parsePostId(input.post_id);
  const videoUrl = parseVideoUrl(input.video_url);
  const supabase = getSupabaseAdminClient();

  console.info(JSON.stringify({
    scope: "admin-post-video",
    event: "post_video_update_start",
    post_id: postId,
    has_video_url: Boolean(videoUrl),
  }));

  const { data, error } = await supabase
    .from("tg_posts")
    .update({
      video_url: videoUrl,
    })
    .eq("id", postId)
    .select("id, video_url")
    .single();

  if (error) {
    throw new HttpError(500, "POST_VIDEO_UPDATE_FAILED", "Failed to update post video URL", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  return {
    ok: true as const,
    post_id: (data as { id?: string })?.id ?? postId,
    video_url: (data as { video_url?: string | null })?.video_url ?? null,
  };
}
