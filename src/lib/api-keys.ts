import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { noStoreFetch } from "./supabase/fetch";
import { createAdminClient } from "./supabase/admin";
import { hasFeature } from "./plans";
import type { Tenant } from "./types";

export function generateApiKey() {
  const key = `amc_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

export function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export interface ApiContext {
  tenant: Tenant;
  keyName: string;
  /** service-role client that labels its writes "API: <key name>" in the activity log */
  db: ReturnType<typeof createAdminClient>;
}

/** Resolve `Authorization: Bearer amc_…` to a tenant, or return an error response. */
export async function authenticateApi(req: Request): Promise<ApiContext | Response> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith("amc_")) return apiError(401, "Missing or malformed API key");
  const admin = createAdminClient();
  const { data: k } = await admin
    .from("api_keys")
    .select("id, name, tenant_id, revoked_at, tenants(*)")
    .eq("key_hash", hashKey(key))
    .maybeSingle();
  if (!k || k.revoked_at) return apiError(401, "Invalid or revoked API key");
  const tenant = k.tenants as unknown as Tenant;
  if (!hasFeature(tenant.subscription_plan, "api")) return apiError(403, "API access requires the Enterprise plan");
  const active =
    tenant.subscription_status === "active" &&
    (!tenant.subscription_ends_at || new Date(tenant.subscription_ends_at) > new Date());
  if (!active) return apiError(402, "Subscription inactive");
  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", k.id);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch, headers: { "x-actor": `API: ${k.name}` } },
  });
  return { tenant, keyName: k.name, db };
}

export function apiError(status: number, message: string, details?: unknown) {
  return Response.json({ error: { message, ...(details ? { details } : {}) } }, { status });
}
