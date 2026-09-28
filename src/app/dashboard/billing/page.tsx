import { requireOwner, tenantIsActive } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bkashConfigured } from "@/lib/bkash";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAID_PLANS, PLANS } from "@/lib/plans";
import type { Subscription } from "@/lib/types";
import { Badge, Flash, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { startCheckout } from "./actions";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant } = await requireOwner();
  const supabase = createClient();
  const [{ data: subs }, { data: credits }, { count: productCount }] = await Promise.all([
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }).limit(24),
    supabase.from("sms_credits").select("balance, last_topup_at").maybeSingle(),
    supabase.from("products").select("id", { count: "exact", head: true }),
  ]);
  const plan = PLANS[tenant.subscription_plan];
  const active = tenantIsActive(tenant);
  const endsAt = tenant.subscription_plan === "trial" ? tenant.trial_ends_at : tenant.subscription_ends_at;
  const online = bkashConfigured();

  return (
    <div className="max-w-5xl">
      <Flash searchParams={searchParams} />
      <PageHeader title="Billing & subscription" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current plan" value={plan.name} hint={active ? "active" : "expired"} tone={active ? undefined : "red"} />
        <Stat label={active ? "Renews / ends" : "Ended"} value={formatDate(endsAt)} />
        <Stat label="Products" value={`${productCount ?? 0}${plan.productLimit ? ` / ${plan.productLimit}` : ""}`} />
        <Stat label="SMS credits" value={credits?.balance ?? 0} hint={credits?.last_topup_at ? `topped up ${formatDate(credits.last_topup_at)}` : undefined} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PAID_PLANS.map((k) => {
          const p = PLANS[k];
          const current = tenant.subscription_plan === k;
          return (
            <div key={k} className={`card ${current ? "ring-2 ring-indigo-500" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{p.name}</span>
                {current && <Badge tone="blue">current</Badge>}
              </div>
              <div className="my-2 text-2xl font-bold">৳{p.priceBdt}<span className="text-sm font-normal text-slate-500">/month</span></div>
              <ul className="mb-4 space-y-1 text-sm text-slate-600">
                <li>{p.productLimit} products</li>
                <li>{p.smsBundle} SMS credits every month</li>
                <li>{p.maxStaff} staff account(s)</li>
              </ul>
              <form action={startCheckout.bind(null, k)}>
                <SubmitButton className="btn-primary w-full bg-pink-600 hover:bg-pink-700" pendingText="Opening bKash…">
                  {current ? "Renew" : "Upgrade"} with bKash
                </SubmitButton>
              </form>
            </div>
          );
        })}
        <div className="card">
          <div className="font-semibold">Enterprise</div>
          <div className="my-2 text-2xl font-bold">Custom</div>
          <p className="mb-4 text-sm text-slate-600">{PLANS.enterprise.blurb}. Contact us for a quote.</p>
        </div>
      </div>
      {!online && <p className="mt-3 text-sm text-amber-700">Online payment isn&apos;t configured on this server yet — contact support to activate a plan.</p>}
      <p className="mt-3 text-xs text-slate-500">Renewing early adds a month on top of your current period — you never lose days.</p>

      <h2 className="mb-2 mt-8 font-semibold">Payment history</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Period</th><th>bKash TrxID</th><th>Status</th></tr></thead>
          <tbody>
            {((subs ?? []) as Subscription[]).map((s) => (
              <tr key={s.id}>
                <td>{formatDateTime(s.created_at)}</td>
                <td>{PLANS[s.plan].name}</td>
                <td>৳{s.amount}</td>
                <td>{s.starts_at ? `${formatDate(s.starts_at)} – ${formatDate(s.ends_at)}` : "—"}</td>
                <td>{s.provider_trx_id ?? "—"}</td>
                <td><StatusBadge status={s.status} /></td>
              </tr>
            ))}
            {!subs?.length && <tr><td colSpan={6} className="text-center text-slate-500">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
