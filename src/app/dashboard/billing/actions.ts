"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { bkashConfigured, createPayment } from "@/lib/bkash";
import { PAID_PLANS, PLANS, SMS_PACKS, yearlyPrice } from "@/lib/plans";
import { redirectWith } from "@/lib/redirect";
import type { Plan } from "@/lib/types";

const BACK = "/dashboard/billing";

/** Insert a pending payment row, create the bKash payment and redirect the owner to bKash. */
async function checkout(row: {
  plan: Plan;
  amount: number;
  billing_cycle: "monthly" | "yearly";
  kind: "plan" | "sms_pack";
  sms_pack_size?: number;
}): Promise<never> {
  const { tenant, user } = await requireOwner();
  if (!bkashConfigured()) redirectWith(BACK, { error: "Online payment is not configured yet. Please contact support." });
  const admin = createAdminClient();
  // Amount is decided server-side from the price table, never taken from the client.
  const { data: sub, error } = await admin
    .from("subscriptions")
    .insert({ tenant_id: tenant.id, status: "pending", ...row })
    .select("id")
    .single();
  if (error || !sub) redirectWith(BACK, { error: "Could not start payment" });

  let bkashURL: string;
  try {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const created = await createPayment({
      amount: row.amount,
      invoice: sub!.id.replace(/-/g, "").slice(0, 20),
      payerReference: user.phone ? user.phone.slice(-11) : tenant.id.slice(0, 8),
      callbackURL: `${base}/api/bkash/callback`,
    });
    await admin.from("subscriptions").update({ payment_ref: created.paymentID }).eq("id", sub!.id);
    bkashURL = created.bkashURL;
  } catch (e) {
    await admin.from("subscriptions").update({ status: "failed" }).eq("id", sub!.id);
    console.error("bKash create failed", e);
    redirectWith(BACK, { error: "bKash is unavailable right now. Please try again in a few minutes." });
  }
  redirect(bkashURL);
}

export async function startCheckout(plan: string, cycle: string) {
  if (!(PAID_PLANS as readonly string[]).includes(plan)) redirectWith(BACK, { error: "Unknown plan" });
  const p = plan as Plan;
  const yearly = cycle === "yearly";
  await checkout({
    plan: p,
    amount: yearly ? yearlyPrice(p)! : PLANS[p].priceBdt!,
    billing_cycle: yearly ? "yearly" : "monthly",
    kind: "plan",
  });
}

export async function buySmsPack(packId: string) {
  const { tenant } = await requireOwner();
  const pack = SMS_PACKS.find((p) => p.id === packId);
  if (!pack) redirectWith(BACK, { error: "Unknown SMS pack" });
  await checkout({
    plan: tenant.subscription_plan,
    amount: pack!.priceBdt,
    billing_cycle: "monthly",
    kind: "sms_pack",
    sms_pack_size: pack!.sms,
  });
}
