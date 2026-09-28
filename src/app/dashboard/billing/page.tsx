import Link from "next/link";
import { requireOwner, tenantIsActive } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bkashConfigured } from "@/lib/bkash";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAID_PLANS, PLANS, SMS_PACKS, yearlyPrice } from "@/lib/plans";
import type { Subscription } from "@/lib/types";
import { Badge, Flash, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { buySmsPack, startCheckout } from "./actions";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: { ok?: string; error?: string; cycle?: string } }) {
  const { tenant } = await requireOwner();
  const supabase = createClient();
  const [{ data: subs }, { data: credits }, { count: productCount }] = await Promise.all([
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("sms_credits").select("balance, last_topup_at, used_today, used_on").maybeSingle(),
    supabase.from("products").select("id", { count: "exact", head: true }),
  ]);
  const plan = PLANS[tenant.subscription_plan];
  const active = tenantIsActive(tenant);
  const endsAt = tenant.subscription_plan === "trial" ? tenant.trial_ends_at : tenant.subscription_ends_at;
  const online = bkashConfigured();
  const yearly = searchParams.cycle === "yearly";

  return (
    <div className="max-w-5xl">
      <Flash searchParams={searchParams} />
      <PageHeader title="Billing & subscription" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current plan" value={plan.name} hint={active ? "active" : "expired"} tone={active ? undefined : "red"} />
        <Stat label={active ? "Renews / ends" : "Ended"} value={formatDate(endsAt)} />
        <Stat label="Products" value={`${productCount ?? 0}${plan.productLimit ? ` / ${plan.productLimit}` : ""}`} />
        <Stat
          label="SMS credits"
          value={credits?.balance ?? 0}
          hint={`daily limit ${tenant.sms_daily_cap}${credits?.last_topup_at ? ` · topped up ${formatDate(credits.last_topup_at)}` : ""}`}
        />
      </div>

      <div className="mb-3 flex items-center gap-1 text-sm">
        <Link href="/dashboard/billing" className={`rounded-md px-3 py-1.5 ${!yearly ? "bg-indigo-600 text-white" : "bg-white"}`}>Monthly</Link>
        <Link href="/dashboard/billing?cycle=yearly" className={`rounded-md px-3 py-1.5 ${yearly ? "bg-indigo-600 text-white" : "bg-white"}`}>Yearly — 2 months free</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {PAID_PLANS.map((k) => {
          const p = PLANS[k];
          const current = tenant.subscription_plan === k;
          const price = yearly ? yearlyPrice(k)! : p.priceBdt!;
          return (
            <div key={k} className={`card ${current ? "ring-2 ring-indigo-500" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold">{p.name}</span>
                {current && <Badge tone="blue">current</Badge>}
              </div>
              <div className="my-2 text-2xl font-bold">
                ৳{price.toLocaleString("en-IN")}
                <span className="text-sm font-normal text-slate-500">/{yearly ? "year" : "month"}</span>
              </div>
              <ul className="mb-4 space-y-1 text-sm text-slate-600">
                <li>{p.productLimit} products</li>
                <li>{p.smsBundle} SMS credits every month{yearly ? ` (${p.smsBundle * 12} up front)` : ""}</li>
                <li>{p.maxStaff} staff account(s)</li>
                {k === "pro" && <li>WhatsApp reminders</li>}
              </ul>
              <form action={startCheckout.bind(null, k, yearly ? "yearly" : "monthly")}>
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
      {!online && <p className="mt-3 text-sm text-amber-700">Online payment isn&apos;t configured on this server yet — contact support to activate a plan (cash / bank payments can be recorded by the platform).</p>}
      <p className="mt-3 text-xs text-slate-500">Renewing early adds the new period on top of your current one — you never lose days.</p>

      <h2 className="mb-2 mt-8 font-semibold">Buy extra SMS credits</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {SMS_PACKS.map((p) => (
          <form key={p.id} action={buySmsPack.bind(null, p.id)} className="card flex items-center justify-between">
            <div>
              <div className="font-semibold">{p.sms.toLocaleString("en-IN")} SMS</div>
              <div className="text-sm text-slate-500">৳{p.priceBdt} · ৳{(p.priceBdt / p.sms).toFixed(2)}/SMS</div>
            </div>
            <SubmitButton className="btn-secondary" pendingText="Opening bKash…">Buy</SubmitButton>
          </form>
        ))}
      </div>

      <h2 className="mb-2 mt-8 font-semibold">Payment history</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead><tr><th>Date</th><th>Item</th><th>Amount</th><th>Period</th><th>TrxID</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {((subs ?? []) as Subscription[]).map((s) => (
              <tr key={s.id}>
                <td>{formatDateTime(s.created_at)}</td>
                <td>{s.kind === "sms_pack" ? `${s.sms_pack_size} SMS credits` : `${PLANS[s.plan].name} (${s.billing_cycle})`}</td>
                <td>৳{Number(s.amount).toLocaleString("en-IN")}</td>
                <td>{s.kind === "plan" && s.starts_at ? `${formatDate(s.starts_at)} – ${formatDate(s.ends_at)}` : "—"}</td>
                <td>{s.provider_trx_id ?? "—"}</td>
                <td><StatusBadge status={s.status} /></td>
                <td>{s.status === "active" && <Link className="text-indigo-700 hover:underline" href={`/dashboard/billing/invoice/${s.id}`}>Invoice</Link>}</td>
              </tr>
            ))}
            {!subs?.length && <tr><td colSpan={7} className="text-center text-slate-500">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
