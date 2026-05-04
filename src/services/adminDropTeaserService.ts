import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

type UpsertDropTeaserInput = {
  title?: unknown;
  short_text?: unknown;
  details?: unknown;
  preview_images?: unknown;
  is_public_immediately?: unknown;
};

type UpsertDropTeaserResponse = {
  ok: true;
  teaser: {
    id: string;
    title: string;
    short_text: string;
    details: string | null;
    preview_images: string[];
    is_active: boolean;
    is_public_immediately: boolean;
    updated_at: string;
  };
};

function parseTextField(raw: unknown, field: string, maxLength: number): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    throw new HttpError(400, "BAD_PAYLOAD", `${field} is required`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, "BAD_PAYLOAD", `${field} is too long`);
  }
  return value;
}

function parseOptionalText(raw: unknown, maxLength: number): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return value.slice(0, maxLength);
}

function parseBooleanField(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  return false;
}

function parsePreviewImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "BAD_PAYLOAD", "preview_images must be an array");
  }
  const normalized = raw
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!normalized.length) {
    throw new HttpError(400, "BAD_PAYLOAD", "preview_images must contain at least one image");
  }
  if (normalized.length > 4) {
    throw new HttpError(400, "BAD_PAYLOAD", "preview_images must contain up to 4 images");
  }
  for (const imageUrl of normalized) {
    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      throw new HttpError(400, "BAD_PAYLOAD", "preview_images must contain valid URLs");
    }
    if (parsed.protocol !== "https:") {
      throw new HttpError(400, "BAD_PAYLOAD", "preview_images must use https");
    }
  }
  return normalized;
}

export async function upsertAdminDropTeaser(input: UpsertDropTeaserInput): Promise<UpsertDropTeaserResponse> {
  const title = parseTextField(input.title, "title", 120);
  const shortText = parseTextField(input.short_text, "short_text", 400);
  const details = parseOptionalText(input.details, 2000);
  const previewImages = parsePreviewImages(input.preview_images);
  const isPublicImmediately = parseBooleanField(input.is_public_immediately);
  const supabase = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: activeRow, error: activeError } = await supabase
    .from("tg_drop_teasers")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();

  if (activeError) {
    throw new HttpError(500, "DROP_TEASER_READ_FAILED", "Failed to read active teaser", {
      message: activeError.message,
      code: activeError.code ?? null,
      details: activeError.details ?? null,
      hint: activeError.hint ?? null,
    });
  }

  const payload = {
    title,
    short_text: shortText,
    details,
    preview_images: previewImages,
    is_active: true,
    is_public_immediately: isPublicImmediately,
    published_at: nowIso,
    updated_at: nowIso,
  };

  if (activeRow?.id) {
    const { data, error } = await supabase
      .from("tg_drop_teasers")
      .update(payload)
      .eq("id", activeRow.id)
      .select("id, title, short_text, details, preview_images, is_active, is_public_immediately, updated_at")
      .single();

    if (error) {
      throw new HttpError(500, "DROP_TEASER_UPDATE_FAILED", "Failed to update active teaser", {
        message: error.message,
        code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
      });
    }

    return {
      ok: true,
      teaser: {
        id: String((data as { id?: unknown }).id ?? activeRow.id),
        title: String((data as { title?: unknown }).title ?? title),
        short_text: String((data as { short_text?: unknown }).short_text ?? shortText),
        details: ((data as { details?: unknown }).details == null ? null : String((data as { details?: unknown }).details)) ?? null,
        preview_images: Array.isArray((data as { preview_images?: unknown }).preview_images)
          ? ((data as { preview_images?: unknown[] }).preview_images ?? []).map((value) => String(value ?? "")).filter(Boolean)
          : previewImages,
        is_active: Boolean((data as { is_active?: unknown }).is_active ?? true),
        is_public_immediately: Boolean((data as { is_public_immediately?: unknown }).is_public_immediately ?? isPublicImmediately),
        updated_at: String((data as { updated_at?: unknown }).updated_at ?? nowIso),
      },
    };
  }

  const { data, error } = await supabase
    .from("tg_drop_teasers")
    .insert(payload)
    .select("id, title, short_text, details, preview_images, is_active, is_public_immediately, updated_at")
    .single();

  if (error) {
    throw new HttpError(500, "DROP_TEASER_INSERT_FAILED", "Failed to create active teaser", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  return {
    ok: true,
    teaser: {
      id: String((data as { id?: unknown }).id ?? ""),
      title: String((data as { title?: unknown }).title ?? title),
      short_text: String((data as { short_text?: unknown }).short_text ?? shortText),
      details: ((data as { details?: unknown }).details == null ? null : String((data as { details?: unknown }).details)) ?? null,
      preview_images: Array.isArray((data as { preview_images?: unknown }).preview_images)
        ? ((data as { preview_images?: unknown[] }).preview_images ?? []).map((value) => String(value ?? "")).filter(Boolean)
        : previewImages,
      is_active: Boolean((data as { is_active?: unknown }).is_active ?? true),
      is_public_immediately: Boolean((data as { is_public_immediately?: unknown }).is_public_immediately ?? isPublicImmediately),
      updated_at: String((data as { updated_at?: unknown }).updated_at ?? nowIso),
    },
  };
}

export async function clearActiveAdminDropTeaser() {
  const supabase = getSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("tg_drop_teasers")
    .update({
      is_active: false,
      updated_at: nowIso,
    })
    .eq("is_active", true)
    .select("id");

  if (error) {
    throw new HttpError(500, "DROP_TEASER_CLEAR_FAILED", "Failed to clear active teaser", {
      message: error.message,
      code: error.code ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    });
  }

  return {
    ok: true as const,
    cleared: Array.isArray(data) ? data.length : 0,
  };
}
