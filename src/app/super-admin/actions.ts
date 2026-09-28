"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeBdPhone } from "@/lib/phone";
import { runDailyJob } from "@/lib/reminders/run";
import { redirectWith } from "@/lib/redirect";

// Every action re-checks super_admin before touching the service-role client.

export async function extendTrial(tenantId: string, fd: FormData) {
  await requireSuperAdmin();
  const days = z.coerce.number().int().min(1).max(365).safeParse(fd.get("days"));
  const back = `/super-admin/tenants/${tenantId}`;
  if (!days.success) redirectWith(back, { error: "Days must be 1–365" });
  const admin = createAdminClient();
  const { data: t } = await admin.from("tenants").select("trial_ends_at").eq("id", tenantId).single();
  if (!t) redirectWith("/super-admin/tenants", { error: "Tenant not found" });
  const base = Math.max(Date.now(), new Date(t!.trial_ends_at).getTime());
  const { error } = await admin
    .from("tenants")
    .update({ trial_ends_at: new Date(base + days.data * 86_400_000).toISOString(), subscription_status: "active", renewal_notice_for: null })
    .eq("id", tenantId)
    .eq("subscription_plan", "trial");
  if (error) redirectWith(back, { error: error.message });
  revalidatePath(back);
  redirectWith(back, { ok: `Trial extended by ${days.data} days.` });
}

const planSchema = z.object({
  plan: z.enum(["trial", "basic", "pro", "enterprise"]),
  status: z.enum(["active", "expired", "cancelled"]),
  ends_at: z.string().optional(),
});

export async function setPlan(tenantId: string, fd: FormData) {
  await requireSuperAdmin();
  const back = `/super-admin/tenants/${tenantId}`;
  const parsed = planSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith(back, { error: "Invalid plan/status" });
  const { plan, status, ends_at } = parsed.data;
  const update: Record<string, unknown> = { subscription_plan: plan, subscription_status: status, renewal_notice_for: null };
  if (ends_at) {
    const iso = new Date(ends_at + "T23:59:59+06:00").toISOString();
    if (plan === "trial") update.trial_ends_at = iso;
    else update.subscription_ends_at = iso;
  }
  const { error } = await createAdminClient().from("tenants").update(update).eq("id", tenantId);
  if (error) redirectWith(back, { error: error.message });
  revalidatePath(back);
  redirectWith(back, { ok: "Plan updated." });
}

export async function addCredits(tenantId: string, fd: FormData) {
  await requireSuperAdmin();
  const back = `/super-admin/tenants/${tenantId}`;
  const n = z.coerce.number().int().min(1).max(100_000).safeParse(fd.get("credits"));
  if (!n.success) redirectWith(back, { error: "Credits must be 1–100000" });
  const { error } = await createAdminClient().rpc("add_sms_credits", { p_tenant: tenantId, p_count: n.data });
  if (error) redirectWith(back, { error: error.message });
  revalidatePath(back);
  redirectWith(back, { ok: `Added ${n.data} SMS credits.` });
}

/** Re-queue failed reminders (one, or all failed for a tenant). */
export async function resendReminders(opts: { reminderId?: string; tenantId?: string; back: string }) {
  await requireSuperAdmin();
  const admin = createAdminClient();
  let q = admin
    .from("reminders")
    .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null }, { count: "exact" })
    .eq("status", "failed");
  if (opts.reminderId) q = q.eq("id", opts.reminderId);
  else if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  const { error, count } = await q;
  if (error) redirectWith(opts.back, { error: error.message });
  revalidatePath(opts.back);
  redirectWith(opts.back, { ok: `${count ?? 0} reminder(s) re-queued. They go out on the next send run (or click "Run send now").` });
}

export async function runJobNow(mode: "daily" | "send") {
  await requireSuperAdmin();
  const res = await runDailyJob(createAdminClient(), { generate: mode === "daily" });
  revalidatePath("/super-admin/health");
  redirectWith("/super-admin/health", res.ok ? { ok: `Job finished: ${JSON.stringify(res.details)}` } : { error: `Job failed: ${res.details.error}` });
}

const newTenantSchema = z.object({
  business_name: z.string().trim().min(2).max(200),
  business_type: z.string().trim().max(100).optional(),
  owner_name: z.string().trim().min(2).max(200),
  phone: z.string().trim().refine((v) => !v || normalizeBdPhone(v) !== null, "Invalid mobile number").optional(),
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  trial_days: z.coerce.number().int().min(1).max(365),
});

/** Manually onboard a shop: creates the owner login; the DB trigger creates the tenant. */
export async function createTenant(fd: FormData) {
  await requireSuperAdmin();
  const parsed = newTenantSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith("/super-admin/tenants/new", { error: parsed.error.issues[0].message });
  const d = parsed.data;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: d.email,
    password: d.password,
    email_confirm: true,
    user_metadata: { business_name: d.business_name, business_type: d.business_type, name: d.owner_name, phone: normalizeBdPhone(d.phone) },
  });
  if (error || !data.user) redirectWith("/super-admin/tenants/new", { error: error?.message ?? "Could not create user" });
  const { data: u } = await admin.from("users").select("tenant_id").eq("id", data.user!.id).single();
  if (!u?.tenant_id) redirectWith("/super-admin/tenants/new", { error: "User created but tenant missing — check the signup trigger." });
  if (d.trial_days !== 14) {
    await admin.from("tenants").update({ trial_ends_at: new Date(Date.now() + d.trial_days * 86_400_000).toISOString() }).eq("id", u!.tenant_id);
  }
  revalidatePath("/super-admin/tenants");
  redirectWith(`/super-admin/tenants/${u!.tenant_id}`, { ok: `Tenant created. Owner login: ${d.email}` });
}
