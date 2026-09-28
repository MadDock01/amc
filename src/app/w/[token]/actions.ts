"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseToken } from "@/lib/links";
import { normalizeBdPhone } from "@/lib/phone";
import { sendEmail } from "@/lib/notify/email";

export type RequestState = { ok?: string; error?: string } | undefined;

/** Public "please call me about renewal" — no login, keyed by the product's secret token. */
export async function requestRenewal(token: string, _: RequestState, fd: FormData): Promise<RequestState> {
  const id = parseToken(token);
  if (!id) return { error: "Invalid link." };
  const parsed = z
    .object({ message: z.string().trim().max(500).optional(), callback_phone: z.string().trim().max(30).optional() })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Message is too long." };
  const phone = parsed.data.callback_phone ? normalizeBdPhone(parsed.data.callback_phone) : null;
  if (parsed.data.callback_phone && !phone) return { error: "Enter a valid mobile number, e.g. 01XXXXXXXXX." };

  const admin = createAdminClient();
  const { data: p } = await admin
    .from("products")
    .select("id, tenant_id, product_name, customers(name, phone), tenants(business_name)")
    .eq("public_token", id)
    .maybeSingle();
  if (!p) return { error: "Invalid link." };

  // Abuse guard: one open request per product per 24h.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin
    .from("renewal_requests")
    .select("id", { count: "exact", head: true })
    .eq("product_id", p.id)
    .gte("created_at", since);
  if ((count ?? 0) > 0) return { ok: "We already have your request — the shop will call you soon." };

  const { error } = await admin.from("renewal_requests").insert({
    tenant_id: p.tenant_id,
    product_id: p.id,
    message: parsed.data.message || null,
    callback_phone: phone,
  });
  if (error) return { error: "Could not send your request. Please call the shop directly." };

  const customer = p.customers as unknown as { name: string; phone: string | null } | null;
  const { data: owners } = await admin.from("users").select("email").eq("tenant_id", p.tenant_id).eq("role", "owner");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  for (const o of owners ?? []) {
    if (o.email) {
      await sendEmail(
        o.email,
        `Renewal request: ${p.product_name} (${customer?.name ?? "customer"})`,
        `${customer?.name ?? "A customer"} asked for a renewal call about ${p.product_name}.\n` +
          `Call back: ${phone ? "0" + phone.slice(3) : customer?.phone ? "0" + customer.phone.slice(3) : "—"}\n` +
          (parsed.data.message ? `Message: ${parsed.data.message}\n` : "") +
          `\nOpen: ${base}/dashboard/requests`,
      );
    }
  }
  return { ok: "Thank you! The shop has been notified and will call you soon." };
}
