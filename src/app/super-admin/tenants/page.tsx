import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { tenantIsActive } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { PLANS } from "@/lib/plans";
import type { Tenant } from "@/lib/types";
import { Badge, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TenantsPage({ searchParams }: { searchParams: { q?: string; status?: "trial" | "paying" | "expired" } }) {
  const supabase = createClient();
  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, " ");
  let query = supabase.from("tenants").select("*").order("created_at", { ascending: false }).limit(1000);
  if (q) query = query.or(`business_name.ilike.%${q}%,phone.ilike.%${q.replace(/^0/, "")}%,business_type.ilike.%${q}%`);
  const [{ data }, { data: usage }] = await Promise.all([
    query,
    supabase.rpc("admin_tenant_usage", { p_since: new Date(Date.now() - 30 * 86_400_000).toISOString() }),
  ]);
  let tenants = (data ?? []) as Tenant[];
  if (searchParams.status === "trial") tenants = tenants.filter((t) => t.subscription_plan === "trial" && tenantIsActive(t));
  if (searchParams.status === "paying") tenants = tenants.filter((t) => t.subscription_plan !== "trial" && tenantIsActive(t));
  if (searchParams.status === "expired") tenants = tenants.filter((t) => !tenantIsActive(t));
  const u = new Map(((usage ?? []) as { tenant_id: string; products: number; sms_segments: number; failed_reminders: number }[]).map((x) => [x.tenant_id, x]));

  return (
    <>
      <PageHeader title="Tenants" subtitle={`${tenants.length} shop(s)`} actions={<Link href="/super-admin/tenants/new" className="btn-primary">+ Onboard tenant</Link>} />
      <form className="mb-4 flex flex-wrap gap-2" action="/super-admin/tenants">
        <input className="input max-w-xs" name="q" defaultValue={searchParams.q} placeholder="Search name, phone, type…" />
        <select className="input w-auto" name="status" defaultValue={searchParams.status ?? ""}>
          <option value="">All</option>
          <option value="trial">Active trial</option>
          <option value="paying">Paying</option>
          <option value="expired">Expired / lapsed</option>
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      {!tenants.length ? <Empty>No tenants match.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th>Business</th><th>Type</th><th>Plan</th><th>Status</th><th>Ends</th><th>Products</th><th>SMS (30d)</th><th>Failed</th><th>Joined</th></tr></thead>
            <tbody>
              {tenants.map((t) => {
                const active = tenantIsActive(t);
                const x = u.get(t.id);
                return (
                  <tr key={t.id}>
                    <td><Link href={`/super-admin/tenants/${t.id}`} className="font-medium text-indigo-700 hover:underline">{t.business_name}</Link></td>
                    <td>{t.business_type ?? "—"}</td>
                    <td>{PLANS[t.subscription_plan].name}</td>
                    <td><Badge tone={active ? (t.subscription_plan === "trial" ? "yellow" : "green") : "red"}>{active ? (t.subscription_plan === "trial" ? "trial" : "active") : t.subscription_status === "active" ? "lapsed" : t.subscription_status}</Badge></td>
                    <td>{formatDate(t.subscription_plan === "trial" ? t.trial_ends_at : t.subscription_ends_at)}</td>
                    <td>{x?.products ?? 0}</td>
                    <td>{x?.sms_segments ?? 0}</td>
                    <td className={Number(x?.failed_reminders) > 0 ? "text-red-700" : ""}>{x?.failed_reminders ?? 0}</td>
                    <td>{formatDate(t.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
