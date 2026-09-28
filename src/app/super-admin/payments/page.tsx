import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { PLANS } from "@/lib/plans";
import type { Subscription } from "@/lib/types";
import { Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = Subscription & { tenants: { business_name: string } | null };

export default async function PaymentsPage({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = createClient();
  const status = ["active", "failed", "pending", "cancelled"].includes(searchParams.status ?? "") ? searchParams.status : undefined;
  let q = supabase.from("subscriptions").select("*, tenants(business_name)").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as Row[];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = rows.filter((r) => r.created_at >= since);
  const paid30 = recent.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.amount), 0);
  const failed30 = recent.filter((r) => r.status === "failed").length;

  return (
    <>
      <PageHeader title="Payments" subtitle="All plan and SMS-pack payments across shops." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Collected (30 days)" value={`৳${paid30.toLocaleString("en-IN")}`} />
        <Stat label="Failed payments (30 days)" value={failed30} tone={failed30 ? "red" : undefined} href="/super-admin/payments?status=failed" />
        <Stat label="Pending / abandoned" value={rows.filter((r) => r.status === "pending").length} href="/super-admin/payments?status=pending" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1 text-xs">
        {["", "active", "failed", "pending", "cancelled"].map((s) => (
          <Link key={s} href={s ? `/super-admin/payments?status=${s}` : "/super-admin/payments"} className={`rounded-full border px-3 py-1 ${(status ?? "") === s ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white"}`}>
            {s || "all"}
          </Link>
        ))}
      </div>
      {!rows.length ? <Empty>No payments.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th>Date</th><th>Shop</th><th>Item</th><th>Amount</th><th>Method</th><th>TrxID / ref</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.created_at)}</td>
                  <td><Link href={`/super-admin/tenants/${r.tenant_id}`} className="text-indigo-700 hover:underline">{r.tenants?.business_name}</Link></td>
                  <td>{r.kind === "sms_pack" ? `${r.sms_pack_size} SMS` : `${PLANS[r.plan].name} (${r.billing_cycle})`}</td>
                  <td>৳{Number(r.amount).toLocaleString("en-IN")}</td>
                  <td>{r.payment_ref?.startsWith("manual:") ? "manual" : "bKash"}</td>
                  <td className="font-mono text-xs">{r.provider_trx_id ?? "—"}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
