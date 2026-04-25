import { HttpError } from "../utils/httpError";
import { getSupabaseAdminClient } from "./adminSession";

type DraftWriteBranch =
  | "update_by_id"
  | "select_by_item_id"
  | "update_existing_by_item_id"
  | "upsert_fallback"
  | "insert_new";

type DraftWritePayload = {
  item_id: number | null;
  nalichie_id: number | null;
  post_type: "warehouse" | "consignment";
  origin_profile: "ODN" | "YAN";
  packaging_preset: "A2" | "A3" | "A4";
  title: string;
  brand: string | null;
  size: string | null;
  price: number;
  description: string;
  condition: string;
  has_defects: boolean;
  defects_text: string | null;
  measurements_text: string | null;
  status: "draft" | "scheduled" | "published" | "archived";
  scheduled_at: string | null;
  published_at: string | null;
};

type DraftWriteUpdatePayload = DraftWritePayload & {
  original_price?: number;
};

type DbErrorPayload = {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
  status: number | null;
};

function normalizeOptionalString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizePayload(raw: unknown): DraftWritePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const postType = row.post_type === "consignment" ? "consignment" : row.post_type === "warehouse" ? "warehouse" : null;
  const origin = row.origin_profile === "YAN" ? "YAN" : row.origin_profile === "ODN" ? "ODN" : null;
  const packaging = row.packaging_preset === "A2" || row.packaging_preset === "A3" || row.packaging_preset === "A4"
    ? row.packaging_preset
    : null;
  const status = row.status === "draft" || row.status === "scheduled" || row.status === "published" || row.status === "archived"
    ? row.status
    : null;
  const title = String(row.title ?? "").trim();
  const description = String(row.description ?? "").trim();
  const condition = String(row.condition ?? "").trim();
  const price = Number(row.price);
  const itemId = row.item_id == null ? null : Number(row.item_id);
  const nalichieId = row.nalichie_id == null ? null : Number(row.nalichie_id);
  const hasDefects = Boolean(row.has_defects);
  const defectsText = hasDefects ? normalizeOptionalString(row.defects_text) : null;
  const measurementsText = normalizeOptionalString(row.measurements_text);

  if (!postType || !origin || !packaging || !status) return null;
  if (!title || !description || !condition || !Number.isFinite(price) || price <= 0) return null;
  if (itemId != null && (!Number.isInteger(itemId) || itemId <= 0)) return null;
  if (nalichieId != null && (!Number.isInteger(nalichieId) || nalichieId <= 0)) return null;

  return {
    item_id: itemId,
    nalichie_id: nalichieId,
    post_type: postType,
    origin_profile: origin,
    packaging_preset: packaging,
    title,
    brand: normalizeOptionalString(row.brand),
    size: normalizeOptionalString(row.size),
    price: Math.round(price),
    description,
    condition,
    has_defects: hasDefects,
    defects_text: defectsText,
    measurements_text: measurementsText,
    status,
    scheduled_at: normalizeOptionalString(row.scheduled_at),
    published_at: normalizeOptionalString(row.published_at),
  };
}

function toDbErrorPayload(error: unknown): DbErrorPayload {
  if (!error || typeof error !== "object") {
    return {
      message: String(error ?? "UNKNOWN_ERROR"),
      code: null,
      details: null,
      hint: null,
      status: null,
    };
  }
  const row = error as Record<string, unknown>;
  return {
    message: String(row.message ?? "UNKNOWN_ERROR"),
    code: row.code == null ? null : String(row.code),
    details: row.details == null ? null : String(row.details),
    hint: row.hint == null ? null : String(row.hint),
    status: typeof row.status === "number" ? row.status : null,
  };
}

function throwDraftWriteError(branch: DraftWriteBranch, error: unknown): never {
  const db = toDbErrorPayload(error);
  console.error(JSON.stringify({
    scope: "admin-draft-post",
    event: "draft_write_branch_error",
    branch,
    db,
  }));
  throw new HttpError(500, "DRAFT_WRITE_FAILED", "Draft write failed", { branch, db });
}

function buildWritePayloadWithOriginalPrice(params: {
  payload: DraftWritePayload;
  existingPrice: number | null;
  existingOriginalPrice: number | null;
  forceInitialize: boolean;
}): DraftWriteUpdatePayload {
  const { payload, existingPrice, existingOriginalPrice, forceInitialize } = params;

  if (forceInitialize) {
    return {
      ...payload,
      original_price: payload.price,
    };
  }

  if (typeof existingOriginalPrice === "number" && existingOriginalPrice > 0) {
    return {
      ...payload,
      original_price: existingOriginalPrice,
    };
  }

  if (typeof existingPrice === "number" && existingPrice > 0 && payload.price < existingPrice) {
    return {
      ...payload,
      original_price: existingPrice,
    };
  }

  return payload;
}

async function ensureNalichieIdNotOccupied(input: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  branch: DraftWriteBranch;
  nalichieId: number | null;
  excludePostId?: string | null;
}) {
  if (input.nalichieId == null) return;
  let query = input.supabase
    .from("tg_posts")
    .select("id")
    .eq("nalichie_id", input.nalichieId);
  if (input.excludePostId) {
    query = query.neq("id", input.excludePostId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throwDraftWriteError(input.branch, error);
  const existingId = (data as { id?: string } | null)?.id ?? null;
  if (existingId) {
    throw new HttpError(409, "NALICHIE_ALREADY_USED", "Nalichie id already used", {
      nalichie_id: input.nalichieId,
      existing_post_id: existingId,
      branch: input.branch,
    });
  }
}

export async function writeAdminDraftPost(input: { post_id?: unknown; payload?: unknown }) {
  const supabase = getSupabaseAdminClient();
  const postId = typeof input.post_id === "string" ? input.post_id.trim() : "";
  const writePayload = normalizePayload(input.payload);
  if (!writePayload) {
    throw new HttpError(400, "BAD_PAYLOAD", "Invalid draft payload");
  }

  let branch: DraftWriteBranch = "insert_new";
  console.info(JSON.stringify({
    scope: "admin-draft-post",
    event: "draft_write_branch_start",
    branch: postId ? "update_by_id" : writePayload.item_id != null ? "select_by_item_id" : "insert_new",
    post_id: postId || null,
    item_id: writePayload.item_id,
    post_type: writePayload.post_type,
  }));

  if (postId) {
    branch = "update_by_id";
    const { data: existingPost, error: existingPostError } = await supabase
      .from("tg_posts")
      .select("id, price, original_price")
      .eq("id", postId)
      .single();
    if (existingPostError) throwDraftWriteError(branch, existingPostError);
    await ensureNalichieIdNotOccupied({
      supabase,
      branch,
      nalichieId: writePayload.nalichie_id,
      excludePostId: postId,
    });
    const payloadWithOriginalPrice = buildWritePayloadWithOriginalPrice({
      payload: writePayload,
      existingPrice: Number((existingPost as { price?: unknown }).price ?? 0),
      existingOriginalPrice: (() => {
        const value = (existingPost as { original_price?: unknown }).original_price;
        return typeof value === "number" ? value : null;
      })(),
      forceInitialize: false,
    });
    const { data, error } = await supabase
      .from("tg_posts")
      .update(payloadWithOriginalPrice)
      .eq("id", postId)
      .select("*")
      .single();
    if (error) throwDraftWriteError(branch, error);
    console.info(JSON.stringify({ scope: "admin-draft-post", event: "draft_write_branch_success", branch, saved_id: (data as { id?: string })?.id ?? null }));
    return { ok: true as const, branch, post: data };
  }

  if (writePayload.item_id != null) {
    branch = "select_by_item_id";
    const { data: existing, error: existingError } = await supabase
      .from("tg_posts")
      .select("id, price, original_price")
      .eq("item_id", writePayload.item_id)
      .maybeSingle();
    if (existingError) throwDraftWriteError(branch, existingError);

    if ((existing as { id?: string } | null)?.id) {
      branch = "update_existing_by_item_id";
      const existingId = (existing as { id: string }).id;
      await ensureNalichieIdNotOccupied({
        supabase,
        branch,
        nalichieId: writePayload.nalichie_id,
        excludePostId: existingId,
      });
      const payloadWithOriginalPrice = buildWritePayloadWithOriginalPrice({
        payload: writePayload,
        existingPrice: Number((existing as { price?: unknown }).price ?? 0),
        existingOriginalPrice: (() => {
          const value = (existing as { original_price?: unknown }).original_price;
          return typeof value === "number" ? value : null;
        })(),
        forceInitialize: false,
      });
      const { data, error } = await supabase
        .from("tg_posts")
        .update(payloadWithOriginalPrice)
        .eq("id", existingId)
        .select("*")
        .single();
      if (error) throwDraftWriteError(branch, error);
      console.info(JSON.stringify({ scope: "admin-draft-post", event: "draft_write_branch_success", branch, saved_id: (data as { id?: string })?.id ?? null }));
      return { ok: true as const, branch, post: data };
    }
  }

  branch = "insert_new";
  await ensureNalichieIdNotOccupied({
    supabase,
    branch,
    nalichieId: writePayload.nalichie_id,
    excludePostId: null,
  });
  const { data, error } = await supabase
    .from("tg_posts")
    .insert(buildWritePayloadWithOriginalPrice({
      payload: writePayload,
      existingPrice: null,
      existingOriginalPrice: null,
      forceInitialize: true,
    }))
    .select("*")
    .single();
  if (error) throwDraftWriteError(branch, error);
  console.info(JSON.stringify({ scope: "admin-draft-post", event: "draft_write_branch_success", branch, saved_id: (data as { id?: string })?.id ?? null }));
  return { ok: true as const, branch, post: data };
}
