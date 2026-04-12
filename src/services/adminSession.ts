import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";

let supabaseAdminClient: SupabaseClient | null = null;

function getSupabaseAdminClient(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new HttpError(500, "SERVER_MISCONFIGURED", "Supabase admin env is not configured");
  }

  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return supabaseAdminClient;
}

export function readAdminTokenFromHeaders(headers: Record<string, unknown>): string {
  const token = String(headers["x-admin-token"] ?? "").trim();
  if (!token) {
    throw new HttpError(401, "UNAUTHORIZED", "Admin token is required");
  }
  return token;
}

export async function requireValidAdminSession(adminToken: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("tg_admin_sessions")
    .select("token, expires_at")
    .eq("token", adminToken)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "SESSION_CHECK_FAILED", "Failed to validate admin session", {
      message: error.message,
    });
  }
  if (!data) {
    throw new HttpError(401, "UNAUTHORIZED", "Admin session not found");
  }

  const expiresAt = String((data as { expires_at?: string | null }).expires_at ?? "").trim();
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
    throw new HttpError(401, "UNAUTHORIZED", "Admin session expired");
  }
}
