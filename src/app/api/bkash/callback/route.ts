import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executePayment, queryPayment } from "@/lib/bkash";

export const dynamic = "force-dynamic";

/**
 * bKash redirects the payer here with ?paymentID=…&status=success|failure|cancel.
 * We never trust the query string alone: the payment is executed/verified
 * against bKash server-to-server, and the amount must match what we billed.
 */
export async function GET(req: NextRequest) {
  const paymentID = req.nextUrl.searchParams.get("paymentID");
  const status = req.nextUrl.searchParams.get("status");
  const back = (msg: { ok?: string; error?: string }) => {
    const url = new URL("/dashboard/billing", req.url);
    if (msg.ok) url.searchParams.set("ok", msg.ok);
    if (msg.error) url.searchParams.set("error", msg.error);
    return NextResponse.redirect(url);
  };
  if (!paymentID) return back({ error: "Missing payment reference" });

  const admin = createAdminClient();
  const { data: sub } = await admin.from("subscriptions").select("*").eq("payment_ref", paymentID).maybeSingle();
  if (!sub) return back({ error: "Payment not found" });
  if (sub.status === "active") return back({ ok: "Payment already confirmed. Thank you!" });

  if (status !== "success") {
    await admin.from("subscriptions").update({ status: status === "cancel" ? "cancelled" : "failed" }).eq("id", sub.id).eq("status", "pending");
    return back({ error: status === "cancel" ? "Payment cancelled." : "Payment failed. No money was taken." });
  }

  let result = await executePayment(paymentID);
  if (result.transactionStatus !== "Completed") result = await queryPayment(paymentID).catch(() => result);

  const paid = result.transactionStatus === "Completed" && Number(result.amount) === Number(sub.amount);
  if (!paid) {
    await admin.from("subscriptions").update({ status: "failed" }).eq("id", sub.id).eq("status", "pending");
    console.error("bKash payment not completed", paymentID, result);
    return back({ error: `Payment could not be confirmed (${result.statusMessage ?? result.transactionStatus ?? "unknown"}).` });
  }

  const { error } = await admin.rpc("activate_subscription", { p_subscription: sub.id, p_trx_id: result.trxID ?? null });
  if (error) {
    console.error("activate_subscription failed", error);
    return back({ error: `Payment received (TrxID ${result.trxID}) but activation failed — support has been notified.` });
  }
  return back({
    ok: sub.kind === "sms_pack"
      ? `Payment successful (TrxID ${result.trxID}). ${sub.sms_pack_size} SMS credits added.`
      : `Payment successful (TrxID ${result.trxID}). Your plan is active.`,
  });
}
