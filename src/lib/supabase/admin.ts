import "server-only";
import { createClient } from "@supabase/supabase-js";
import { noStoreFetch } from "./fetch";

/**
 * Service-role client. BYPASSES RLS — only use it in server code after you
 * have checked the caller's permissions yourself (cron, webhooks, staff
 * management, super admin actions).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}
