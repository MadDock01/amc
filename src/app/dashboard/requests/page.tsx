import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import type { RenewalRequest } from "@/lib/types";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { markHandled } from "./actions";

export const dynamic = "force-dynamic";

type Row = RenewalRequest & { products: { id: string; product_name: string; customers: { name: string; phone: string | null } | null } | null };

export default async function RequestsPage({ searchParams }: { searchParams: { status?: string; ok?: string; error?: string } }) {
  await requireTenantUser();
  const status = searchParams.status === "handled" ? "handled" : "new";
  const { data } = await createClient()
    .from("renewal_requests")
    .select("*, products(id, product_name, customers(name, phone))")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  return (
    <>
      <Flash searchParams={searchParams} />
      <PageHeader title="Renewal requests" subtitle="Customers who tapped “Request a renewal call” on their warranty status link. Call them — these are warm leads." />
      <div className="mb-4 flex gap-1 text-sm">
        <Link href="/dashboard/requests" className={`rounded-md px-3 py-1.5 ${status === "new" ? "bg-indigo-600 text-white" : "bg-white"}`}>New</Link>
        <Link href="/dashboard/requests?status=handled" className={`rounded-md px-3 py-1.5 ${status === "handled" ? "bg-indigo-600 text-white" : "bg-white"}`}>Handled</Link>
      </div>
      {!rows.length ? (
        <Empty>{status === "new" ? "No new requests." : "Nothing handled yet."}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th>When</th><th>Customer</th><th>Call back on</th><th>Product</th><th>Message</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.created_at)}</td>
                  <td>{r.products?.customers?.name ?? "—"}</td>
                  <td className="font-medium">{displayPhone(r.callback_phone ?? r.products?.customers?.phone)}</td>
                  <td>{r.products ? <Link className="text-indigo-700 hover:underline" href={`/dashboard/products/${r.products.id}`}>{r.products.product_name}</Link> : "—"}</td>
                  <td className="max-w-sm !whitespace-normal text-xs">{r.message ?? "—"}</td>
                  <td>
                    {r.status === "new" ? (
                      <form action={markHandled.bind(null, r.id)}><SubmitButton className="btn-secondary" pendingText="…">Mark handled</SubmitButton></form>
                    ) : (
                      <Badge tone="green">handled {r.handled_at ? formatDateTime(r.handled_at) : ""}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
