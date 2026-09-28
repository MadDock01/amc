"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { bkashConfigured, createPayment } from "@/lib/bkash";
import { PAID_PLANS, PLANS } from "@/lib/plans";
import { redirectWith } from "@/lib/redirect";

export async function startCheckout(plan: string) {
  const { tenant, user } = await requireOwner();
  if (!(PAID_PLANS as readonly string[]).includes(plan)) redirectWith("/dashboard/billing", { error: "Unknown plan" });
  if (!bkashConfigured()) redirectWith("/dashboard/billing", { error: "Online payment is not configured yet. Please contact support." });
  const p = plan as (typeof PAID_PLANS)[number];
  const amount = PLANS[p].priceBdt!;
  const admin = createAdminClient();

  // Amount is decided server-side from the plan, never taken from the client.
  const { data: sub, error } = await admin
    .from("subscriptions")
    .insert({ tenant_id: tenant.id, plan: p, amount, billing_cycle: "monthly", status: "pending" })
    .select("id")
    .single();
  if (error || !sub) redirectWith("/dashboard/billing", { error: "Could not start payment" });

  let bkashURL: string;
  try {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const created = await createPayment({
      amount,
      invoice: sub!.id.replace(/-/g, "").slice(0, 20),
      payerReference: user.phone ? user.phone.slice(-11) : tenant.id.slice(0, 8),
      callbackURL: `${base}/api/bkash/callback`,
    });
    await admin.from("subscriptions").update({ payment_ref: created.paymentID }).eq("id", sub!.id);
    bkashURL = created.bkashURL;
  } catch (e) {
    await admin.from("subscriptions").update({ status: "failed" }).eq("id", sub!.id);
    console.error("bKash create failed", e);
    redirectWith("/dashboard/billing", { error: "bKash is unavailable right now. Please try again in a few minutes." });
  }
  redirect(bkashURL);
}
