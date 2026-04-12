import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

function parsePostId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, "BAD_PAYLOAD", "post_id must be UUID");
  }
  return value;
}

export async function publishPostById(raw: unknown) {
  const row = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const postId = parsePostId(row.post_id);
  const supabase = getSupabaseAdminClient();

  console.info(JSON.stringify({
    scope: "admin-post-publish",
    event: "post_publish_start",
    post_id: postId,
  }));

  const { data, error } = await supabase
    .from("tg_posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      scheduled_at: null,
      sale_status: "available",
    })
    .eq("id", postId)
    .select("*")
    .single();

  if (error) {
    console.error(JSON.stringify({
      scope: "admin-post-publish",
      event: "post_publish_error",
      post_id: postId,
      db_message: error.message,
      db_code: error.code ?? null,
      db_details: error.details ?? null,
      db_hint: error.hint ?? null,
    }));
    throw new HttpError(500, "POST_PUBLISH_FAILED", "Failed to publish post", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  const status = String((data as { status?: unknown })?.status ?? "");
  console.info(JSON.stringify({
    scope: "admin-post-publish",
    event: "post_publish_success",
    post_id: postId,
    status,
  }));

  return {
    ok: true as const,
    post_id: postId,
    status: "published" as const,
    post: data,
  };
}
