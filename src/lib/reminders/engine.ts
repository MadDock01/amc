import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, daysBetween, formatDate, todayISO } from "../dates";
import { customerSms, localPhone, ownerSms, reminderEmail, type ReminderMessageInput } from "../notify/messages";
import { sendEmail } from "../notify/email";
import { sendSms, smsCostPerSegment, smsSegments } from "../notify/sms";
import { sendWhatsApp } from "../notify/whatsapp";
import { normalizeBdPhone } from "../phone";
import { publicLinkFor } from "../links";
import type { Customer, Product, Reminder, Tenant } from "../types";

export const MAX_ATTEMPTS = 3;
/** Pause between provider calls so we stay under the SMS gateway's rate limit. */
const SEND_DELAY_MS = Number(process.env.SMS_SEND_DELAY_MS ?? "200");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff: 30 min, 2 h, 8 h … */
export function retryDelayMs(attempts: number): number {
  return 30 * 60_000 * Math.pow(4, Math.max(0, attempts - 1));
}


type ProductRow = Product & { customers: Customer; tenants: Tenant };

export interface ProcessSummary {
  claimed: number;
  sent: number;
  failed: number;
  retrying: number;
  cancelled: number;
}

interface DeliveryOutcome {
  attempted: number;
  succeeded: number;
  errors: string[];
  /** hit the shop's daily SMS cap — retry tomorrow without counting an attempt */
  deferred?: boolean;
}

/** 09:00 Bangladesh time tomorrow. */
function tomorrowMorning(): string {
  return new Date(addDaysISO(todayISO(), 1) + "T09:00:00+06:00").toISOString();
}

export interface ProcessSummaryWithDeferred extends ProcessSummary {
  deferred: number;
}

/**
 * Send all due reminders. Safe to run concurrently — reminders are claimed
 * with SKIP LOCKED + a lease in claim_due_reminders().
 */
export async function processReminderQueue(
  admin: SupabaseClient,
  opts: { limit?: number; ids?: string[] } = {},
): Promise<ProcessSummaryWithDeferred> {
  const summary: ProcessSummaryWithDeferred = { claimed: 0, sent: 0, failed: 0, retrying: 0, cancelled: 0, deferred: 0 };

  const { data: claimed, error } = opts.ids
    ? await admin.rpc("claim_reminders_by_id", { p_ids: opts.ids })
    : await admin.rpc("claim_due_reminders", { p_limit: opts.limit ?? 200 });
  if (error) throw new Error(`claim reminders: ${error.message}`);
  const reminders = (claimed ?? []) as Reminder[];
  summary.claimed = reminders.length;
  if (!reminders.length) return summary;

  const productIds = [...new Set(reminders.map((r) => r.product_id))];
  const { data: products, error: pErr } = await admin
    .from("products")
    .select("*, customers(*), tenants(*)")
    .in("id", productIds);
  if (pErr) throw new Error(`load products: ${pErr.message}`);
  const byId = new Map((products as ProductRow[]).map((p) => [p.id, p]));

  // owner emails per tenant (only needed for email reminders)
  const tenantIds = [...new Set(reminders.filter((r) => r.channel === "email").map((r) => r.tenant_id))];
  const ownerEmails = new Map<string, string[]>();
  if (tenantIds.length) {
    const { data: owners } = await admin.from("users").select("tenant_id, email").eq("role", "owner").in("tenant_id", tenantIds);
    for (const o of owners ?? []) {
      if (!o.email) continue;
      ownerEmails.set(o.tenant_id, [...(ownerEmails.get(o.tenant_id) ?? []), o.email]);
    }
  }

  for (const r of reminders) {
    const p = byId.get(r.product_id);
    const currentExpiry = p ? (r.reminder_type === "amc" ? p.amc_expiry_date : p.warranty_expiry_date) : null;
    const tenantActive =
      p &&
      p.tenants.subscription_status === "active" &&
      (p.tenants.subscription_plan === "trial"
        ? new Date(p.tenants.trial_ends_at) > new Date()
        : !p.tenants.subscription_ends_at || new Date(p.tenants.subscription_ends_at) > new Date());

    let cancelReason: string | null = null;
    if (!p) cancelReason = "product deleted";
    else if (!p.is_active) cancelReason = "product archived";
    else if (currentExpiry !== r.expiry_date) cancelReason = "expiry date changed";
    else if (!r.is_manual && r.expiry_date < todayISO()) cancelReason = "already expired";
    else if (!tenantActive) cancelReason = "shop subscription inactive";
    if (cancelReason || !p) {
      await admin.from("reminders").update({ status: "cancelled", last_error: cancelReason }).eq("id", r.id);
      summary.cancelled++;
      continue;
    }

    const input: ReminderMessageInput = {
      language: p.tenants.sms_language,
      template: p.tenants.sms_template,
      customerName: p.customers.name,
      productName: p.product_name,
      type: r.reminder_type,
      expiry: r.expiry_date,
      daysLeft: daysBetween(todayISO(), r.expiry_date),
      shopName: p.tenants.business_name,
      shopPhone: p.tenants.phone,
      link: publicLinkFor(p.public_token),
    };

    const outcome =
      r.channel === "sms"
        ? await deliverSms(admin, r, p, input)
        : r.channel === "email"
          ? await deliverEmail(admin, r, p, input, ownerEmails.get(r.tenant_id) ?? [])
          : await deliverWhatsApp(admin, r, p, input);

    if (outcome.deferred && outcome.succeeded === 0) {
      await admin
        .from("reminders")
        .update({ status: "pending", next_attempt_at: tomorrowMorning(), last_error: "daily SMS limit reached — will send tomorrow" })
        .eq("id", r.id);
      summary.deferred++;
    } else if (outcome.attempted === 0) {
      await admin
        .from("reminders")
        .update({ status: "cancelled", last_error: outcome.errors[0] ?? "no recipients" })
        .eq("id", r.id);
      summary.cancelled++;
    } else if (outcome.succeeded > 0) {
      // Partial success still counts as sent: retrying would re-message the
      // recipients that already got it.
      await admin
        .from("reminders")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: r.attempts + 1,
          last_error: outcome.errors.length ? outcome.errors.join("; ").slice(0, 500) : null,
        })
        .eq("id", r.id);
      summary.sent++;
    } else {
      const attempts = r.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await admin
        .from("reminders")
        .update({
          status: giveUp ? "failed" : "pending",
          attempts,
          next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
          last_error: outcome.errors.join("; ").slice(0, 500),
        })
        .eq("id", r.id);
      if (giveUp) summary.failed++;
      else summary.retrying++;
    }
  }
  return summary;
}

async function deliverSms(admin: SupabaseClient, r: Reminder, p: ProductRow, input: ReminderMessageInput): Promise<DeliveryOutcome> {
  const targets: { phone: string; text: string }[] = [];
  const customerPhone = normalizeBdPhone(p.customers.phone);
  if (customerPhone) targets.push({ phone: customerPhone, text: customerSms(input) });
  const ownerPhone = p.tenants.notify_owner_sms ? normalizeBdPhone(p.tenants.phone) : null;
  if (ownerPhone && ownerPhone !== customerPhone) {
    targets.push({ phone: ownerPhone, text: ownerSms({ ...input, customerPhone: p.customers.phone }) });
  }
  const outcome: DeliveryOutcome = { attempted: 0, succeeded: 0, errors: [] };
  if (!targets.length) {
    outcome.errors.push("no valid phone number");
    return outcome;
  }

  for (const t of targets) {
    const segments = smsSegments(t.text);
    const { data: status, error } = await admin.rpc("consume_sms_credits_capped", { p_tenant: r.tenant_id, p_count: segments });
    if (status === "daily_cap") {
      outcome.deferred = true;
      continue;
    }
    outcome.attempted++;
    if (error || status !== "ok") {
      const msg = error ? `credit check failed: ${error.message}` : "insufficient SMS credits";
      outcome.errors.push(msg);
      await logNotification(admin, r, { channel: "sms", recipient_phone: t.phone, message_content: t.text, status: "failed", provider_response: msg });
      continue;
    }
    const res = await sendSms(t.phone, t.text);
    if (!res.ok) {
      await admin.rpc("refund_sms_credits", { p_tenant: r.tenant_id, p_count: segments });
      outcome.errors.push(`sms to ${t.phone} failed`);
    } else {
      outcome.succeeded++;
    }
    await logNotification(admin, r, {
      channel: "sms",
      recipient_phone: t.phone,
      message_content: t.text,
      status: res.ok ? "sent" : "failed",
      provider_response: res.providerResponse,
      sms_segments: res.ok ? segments : 0,
      cost: res.ok ? segments * smsCostPerSegment() : 0,
    });
    if (SEND_DELAY_MS) await sleep(SEND_DELAY_MS);
  }
  return outcome;
}

/** WhatsApp to the customer. Uses 1 SMS credit per message. */
async function deliverWhatsApp(admin: SupabaseClient, r: Reminder, p: ProductRow, input: ReminderMessageInput): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = { attempted: 0, succeeded: 0, errors: [] };
  const phone = normalizeBdPhone(p.customers.phone);
  if (!phone) {
    outcome.errors.push("no valid phone number");
    return outcome;
  }
  const { data: status, error } = await admin.rpc("consume_sms_credits_capped", { p_tenant: r.tenant_id, p_count: 1 });
  if (status === "daily_cap") return { ...outcome, deferred: true };
  outcome.attempted++;
  const preview = customerSms({ ...input, template: null, language: "en" });
  if (error || status !== "ok") {
    const msg = error ? `credit check failed: ${error.message}` : "insufficient SMS credits";
    outcome.errors.push(msg);
    await logNotification(admin, r, { channel: "whatsapp", recipient_phone: phone, message_content: preview, status: "failed", provider_response: msg });
    return outcome;
  }
  const res = await sendWhatsApp(
    phone,
    [input.customerName, input.productName, input.type === "amc" ? "AMC" : "warranty", formatDate(input.expiry), input.shopName, localPhone(input.shopPhone)],
    preview,
  );
  if (res.ok) outcome.succeeded++;
  else {
    await admin.rpc("refund_sms_credits", { p_tenant: r.tenant_id, p_count: 1 });
    outcome.errors.push(`whatsapp to ${phone} failed`);
  }
  await logNotification(admin, r, {
    channel: "whatsapp",
    recipient_phone: phone,
    message_content: preview,
    status: res.ok ? "sent" : "failed",
    provider_response: res.providerResponse,
    cost: res.ok ? Number(process.env.WHATSAPP_COST_PER_MESSAGE ?? "0") || 0 : 0,
  });
  return outcome;
}

async function deliverEmail(
  admin: SupabaseClient,
  r: Reminder,
  p: ProductRow,
  input: ReminderMessageInput,
  owners: string[],
): Promise<DeliveryOutcome> {
  const targets: { email: string; subject: string; text: string }[] = [];
  if (p.customers.email) targets.push({ email: p.customers.email, ...reminderEmail(input, "customer") });
  if (p.tenants.notify_owner_email) {
    for (const e of owners) {
      if (e !== p.customers.email) targets.push({ email: e, ...reminderEmail(input, "owner", p.customers.phone) });
    }
  }
  const outcome: DeliveryOutcome = { attempted: 0, succeeded: 0, errors: [] };
  if (!targets.length) {
    outcome.errors.push("no email recipients");
    return outcome;
  }
  for (const t of targets) {
    outcome.attempted++;
    const res = await sendEmail(t.email, t.subject, t.text);
    if (res.ok) outcome.succeeded++;
    else outcome.errors.push(`email to ${t.email} failed`);
    await logNotification(admin, r, {
      channel: "email",
      recipient_email: t.email,
      message_content: `${t.subject}\n\n${t.text}`,
      status: res.ok ? "sent" : "failed",
      provider_response: res.providerResponse,
    });
  }
  return outcome;
}

async function logNotification(admin: SupabaseClient, r: Reminder, row: Record<string, unknown>) {
  const { error } = await admin.from("notification_logs").insert({ tenant_id: r.tenant_id, reminder_id: r.id, kind: "reminder", ...row });
  if (error) console.error("notification_logs insert failed", error.message);
}

/**
 * "Eat your own dog food": remind shop owners 3 days before their own trial
 * or subscription ends. De-duplicated with tenants.renewal_notice_for.
 */
export async function sendPlatformRenewalNotices(admin: SupabaseClient): Promise<number> {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * 86_400_000).toISOString();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select("*")
    .eq("subscription_status", "active")
    .or(
      `and(subscription_plan.eq.trial,trial_ends_at.lte.${soon},trial_ends_at.gt.${now.toISOString()}),` +
        `and(subscription_plan.neq.trial,subscription_ends_at.lte.${soon},subscription_ends_at.gt.${now.toISOString()})`,
    );
  if (error) throw new Error(`renewal notices: ${error.message}`);

  let sent = 0;
  for (const t of (tenants ?? []) as Tenant[]) {
    const endsAt = t.subscription_plan === "trial" ? t.trial_ends_at : t.subscription_ends_at!;
    if (t.renewal_notice_for && new Date(t.renewal_notice_for).getTime() === new Date(endsAt).getTime()) continue;

    const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - now.getTime()) / 86_400_000));
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const what = t.subscription_plan === "trial" ? "free trial" : "subscription";
    const text = `${t.business_name}: your Warranty Reminder ${what} ends in ${days} day(s). Renew to keep reminders going: ${base}/dashboard/billing`;

    const { data: owners } = await admin.from("users").select("email").eq("tenant_id", t.id).eq("role", "owner");
    for (const o of owners ?? []) {
      if (!o.email) continue;
      const res = await sendEmail(o.email, `Your ${what} ends in ${days} day(s)`, text);
      await admin.from("notification_logs").insert({
        tenant_id: t.id, kind: "platform_renewal", channel: "email", recipient_email: o.email,
        message_content: text, status: res.ok ? "sent" : "failed", provider_response: res.providerResponse,
      });
    }
    const phone = normalizeBdPhone(t.phone);
    if (phone) {
      // Platform notices are on us — they don't consume the shop's SMS credits.
      const res = await sendSms(phone, text);
      const segments = smsSegments(text);
      await admin.from("notification_logs").insert({
        tenant_id: t.id, kind: "platform_renewal", channel: "sms", recipient_phone: phone, message_content: text,
        status: res.ok ? "sent" : "failed", provider_response: res.providerResponse,
        sms_segments: res.ok ? segments : 0, cost: res.ok ? segments * smsCostPerSegment() : 0,
      });
    }
    await admin.from("tenants").update({ renewal_notice_for: endsAt }).eq("id", t.id);
    sent++;
  }
  return sent;
}
