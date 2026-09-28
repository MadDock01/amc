import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import { PLANS } from "@/lib/plans";
import type { Subscription } from "@/lib/types";
import { PrintButton } from "@/components/print-button";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const { tenant } = await requireOwner();
  const { data } = await createClient().from("subscriptions").select("*").eq("id", params.id).eq("status", "active").maybeSingle();
  if (!data) notFound();
  const s = data as Subscription;
  const item = s.kind === "sms_pack" ? `${s.sms_pack_size} SMS credits` : `${PLANS[s.plan].name} plan — ${s.billing_cycle} subscription`;
  const seller = process.env.INVOICE_SELLER_NAME ?? "Warranty Reminder";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex justify-end"><PrintButton label="Print / Save PDF" /></div>
      <div className="card p-8">
        <div className="flex justify-between">
          <div>
            <div className="text-xl font-bold">{seller}</div>
            {process.env.INVOICE_SELLER_ADDRESS && <div className="text-sm text-slate-500">{process.env.INVOICE_SELLER_ADDRESS}</div>}
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">INVOICE / RECEIPT</div>
            <div className="text-sm text-slate-500">No. INV-{String(s.invoice_no).padStart(6, "0")}</div>
            <div className="text-sm text-slate-500">{formatDate(s.starts_at ?? s.created_at)}</div>
          </div>
        </div>
        <div className="mt-8 text-sm">
          <div className="text-slate-500">Billed to</div>
          <div className="font-medium">{tenant.business_name}</div>
          <div>{tenant.address}</div>
          <div>{displayPhone(tenant.phone)}</div>
        </div>
        <table className="table mt-8">
          <thead><tr><th>Description</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            <tr>
              <td>
                {item}
                {s.kind === "plan" && s.starts_at && <div className="text-xs text-slate-500">{formatDate(s.starts_at)} – {formatDate(s.ends_at)}</div>}
              </td>
              <td className="text-right">৳{Number(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td className="font-semibold">Total paid</td>
              <td className="text-right font-semibold">৳{Number(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-6 text-sm text-slate-600">
          Paid via {s.payment_ref?.startsWith("manual:") ? "manual payment" : "bKash"}{s.provider_trx_id ? ` · TrxID ${s.provider_trx_id}` : ""}
        </div>
      </div>
    </div>
  );
}
