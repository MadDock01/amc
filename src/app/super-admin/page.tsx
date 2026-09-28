import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { monthlyPrice, PLANS } from "@/lib/plans";
import type { Tenant } from "@/lib/types";
import { tenantIsActive } from "@/lib/auth";
import { RevenueCostChart } from "@/components/revenue-cost-chart";
import { PageHeader, Stat, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const bdt = (n: number) =>
  `৳${n.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;

export default async function SuperAdminOverview() {
  const supabase = createClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: tenantsData }, { data: stats }, { data: usage }, { data: lastRun }, { count: failed24h }] = await Promise.all([
    supabase.from("tenants").select("*").limit(5000),
    supabase.rpc("admin_monthly_stats", { p_months: 6 }),
    supabase.rpc("admin_tenant_usage", { p_since: monthStart.toISOString() }),
    supabase.from("cron_runs").select("*").eq("job", "daily-reminders").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("notification_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("sent_at", new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  const tenants = (tenantsData ?? []) as Tenant[];
  const byId = new Map(tenants.map((t) => [t.id, t]));

  const paying = tenants.filter((t) => t.subscription_plan !== "trial" && tenantIsActive(t));
  const trials = tenants.filter((t) => t.subscription_plan === "trial" && tenantIsActive(t));
  const expired = tenants.filter((t) => !tenantIsActive(t));
  const mrr = paying.reduce((s, t) => s + monthlyPrice(t.subscription_plan), 0);
  const months = ((stats ?? []) as { month: string; revenue: number; sms_segments: number; sms_cost: number; new_tenants: number }[]).map((m) => ({
    month: m.month, revenue: Number(m.revenue), smsCost: Number(m.sms_cost), segments: Number(m.sms_segments), newTenants: Number(m.new_tenants),
  }));
  const thisMonth = months[months.length - 1] ?? { revenue: 0, smsCost: 0, segments: 0, newTenants: 0 };
  const topUsage = ((usage ?? []) as { tenant_id: string; sms_segments: number; sms_cost: number; products: number; failed_reminders: number }[])
    .filter((u) => Number(u.sms_segments) > 0)
    .sort((a, b) => Number(b.sms_segments) - Number(a.sms_segments))
    .slice(0, 10);
  const renewingSoon = paying
    .filter((t) => t.subscription_ends_at && new Date(t.subscription_ends_at).getTime() < Date.now() + 7 * 86_400_000)
    .sort((a, b) => a.subscription_ends_at!.localeCompare(b.subscription_ends_at!));

  return (
    <>
      <PageHeader title="Platform overview" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="MRR" value={bdt(mrr)} hint={`${paying.length} paying shop(s)`} />
        <Stat label="Active trials" value={trials.length} hint={`${thisMonth.newTenants} signups this month`} href="/super-admin/tenants?status=trial" />
        <Stat label="Expired / lapsed" value={expired.length} href="/super-admin/tenants?status=expired" />
        <Stat label="Revenue this month" value={bdt(thisMonth.revenue)} />
        <Stat label="SMS cost this month" value={bdt(thisMonth.smsCost)} hint={`${thisMonth.segments} SMS parts`} />
        <Stat
          label="Last daily job"
          value={lastRun ? <StatusBadge status={lastRun.status} /> : "never"}
          hint={lastRun ? formatDateTime(lastRun.started_at) : "check cron setup"}
          tone={!lastRun || lastRun.status === "error" ? "red" : undefined}
          href="/super-admin/health"
        />
      </div>
      {(failed24h ?? 0) > 0 && (
        <p className="mt-3 text-sm text-red-700">
          {failed24h} notification(s) failed in the last 24 h — <Link href="/super-admin/health" className="underline">see system health</Link>.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-2 font-semibold">Revenue vs SMS cost (last 6 months)</h2>
          <RevenueCostChart data={months} />
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Plan mix</h2>
          <ul className="space-y-1 text-sm">
            {(Object.keys(PLANS) as (keyof typeof PLANS)[]).map((p) => {
              const n = tenants.filter((t) => t.subscription_plan === p && tenantIsActive(t)).length;
              return <li key={p} className="flex justify-between"><span>{PLANS[p].name}</span><span className="font-medium">{n}</span></li>;
            })}
          </ul>
          <h2 className="mb-2 mt-6 font-semibold">Renewing in next 7 days</h2>
          {!renewingSoon.length ? <p className="text-sm text-slate-500">None.</p> : (
            <ul className="space-y-1 text-sm">
              {renewingSoon.map((t) => (
                <li key={t.id} className="flex justify-between">
                  <Link href={`/super-admin/tenants/${t.id}`} className="text-indigo-700 hover:underline">{t.business_name}</Link>
                  <span className="text-slate-500">{formatDateTime(t.subscription_ends_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-6">
        <h2 className="mb-2 font-semibold">SMS usage this month — margin per shop</h2>
        <p className="mb-3 text-xs text-slate-500">
          Cost uses SMS_COST_PER_MESSAGE at send time. Price per bundled SMS = plan price ÷ bundled SMS. Watch for shops where cost approaches the plan price.
        </p>
        {!topUsage.length ? <p className="text-sm text-slate-500">No SMS sent this month.</p> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Shop</th><th>Plan</th><th>SMS parts</th><th>Our cost</th><th>Plan price</th><th>Margin</th></tr></thead>
              <tbody>
                {topUsage.map((u) => {
                  const t = byId.get(u.tenant_id);
                  const price = t ? monthlyPrice(t.subscription_plan) : 0;
                  const margin = price - Number(u.sms_cost);
                  return (
                    <tr key={u.tenant_id}>
                      <td><Link href={`/super-admin/tenants/${u.tenant_id}`} className="text-indigo-700 hover:underline">{t?.business_name ?? u.tenant_id}</Link></td>
                      <td>{t ? PLANS[t.subscription_plan].name : "—"}</td>
                      <td>{u.sms_segments}</td>
                      <td>{bdt(Number(u.sms_cost))}</td>
                      <td>{bdt(price)}</td>
                      <td className={margin < 0 ? "font-medium text-red-700" : ""}>{bdt(margin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
