import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { AppUser, Tenant } from "./types";

export interface SessionContext {
  user: AppUser;
  tenant: Tenant | null;
}

/** Current user + tenant (memoised per request). Null when signed out. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: user } = await supabase.from("users").select("*").eq("id", authUser.id).single();
  if (!user) return null;

  let tenant: Tenant | null = null;
  if (user.tenant_id) {
    const { data } = await supabase.from("tenants").select("*").eq("id", user.tenant_id).single();
    tenant = data as Tenant | null;
  }
  return { user: user as AppUser, tenant };
});

/** Owner or staff of a shop. Super admins are sent to their own panel. */
export async function requireTenantUser(): Promise<SessionContext & { tenant: Tenant }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.user.role === "super_admin") redirect("/super-admin");
  if (!s.tenant) redirect("/login?error=no-tenant");
  return s as SessionContext & { tenant: Tenant };
}

export async function requireOwner() {
  const s = await requireTenantUser();
  if (s.user.role !== "owner") redirect("/dashboard?error=owner-only");
  return s;
}

export async function requireSuperAdmin(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.user.role !== "super_admin") redirect("/dashboard");
  return s;
}

export function homeFor(role: AppUser["role"]) {
  return role === "super_admin" ? "/super-admin" : "/dashboard";
}

export function tenantIsActive(t: Tenant): boolean {
  if (t.subscription_status !== "active") return false;
  if (t.subscription_plan === "trial") return new Date(t.trial_ends_at) > new Date();
  return !t.subscription_ends_at || new Date(t.subscription_ends_at) > new Date();
}
