import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tenantIsActive } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import { PLANS } from "@/lib/plans";
import type { AppUser, NotificationLog, Reminder, Subscription, Tenant } from "@/lib/types";
import { Badge, Flash, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { addCredits, extendTrial, recordManualPayment, resendReminders, setPlan, setSmsCap } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TenantDetail({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const supabase = createClient();
  const { data: t } = await supabase.from("tenants").select("*").eq("id", params.id).maybeSingle();
  if (!t) notFound();
  const tenant = t as Tenant;
  const back = `/super-admin/tenants/${tenant.id}`;

  const [{ data: users }, { count: products }, { count: customers }, { data: credits }, { data: subs }, { data: failed }, { data: logs }, { data: activity }] = await Promise.all([
    supabase.from("users").select("*").eq("tenant_id", tenant.id),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("sms_credits").select("*").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("subscriptions").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("reminders").select("*, products(product_name)").eq("tenant_id", tenant.id).eq("status", "failed").order("created_at", { ascending: false }).limit(50),
    supabase.from("notification_logs").select("*").eq("tenant_id", tenant.id).order("sent_at", { ascending: false }).limit(20),
    supabase.from("activity_logs").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const active = tenantIsActive(tenant);
  const endsAt = tenant.subscription_plan === "trial" ? tenant.trial_ends_at : tenant.subscription_ends_at;

  return (
    <>
      <Flash searchParams={searchParams} />
      <PageHeader
        title={tenant.business_name}
        subtitle={[tenant.business_type, displayPhone(tenant.phone), tenant.address].filter(Boolean).join(" · ")}
      />
      <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
        Support view. Customer personal data is visible here for support purposes only — don&apos;t export or share it.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Plan" value={PLANS[tenant.subscription_plan].name} hint={active ? "active" : "inactive"} tone={active ? undefined : "red"} />
        <Stat label="Ends" value={formatDate(endsAt)} />
        <Stat label="Products" value={products ?? 0} hint={`${customers ?? 0} customers`} />
        <Stat label="SMS credits" value={credits?.balance ?? 0} />
        <Stat label="Failed reminders" value={failed?.length ?? 0} tone={failed?.length ? "red" : undefined} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <form action={setPlan.bind(null, tenant.id)} className="card space-y-2">
          <h2 className="font-semibold">Plan & status</h2>
          <select className="input" name="plan" defaultValue={tenant.subscription_plan}>
            {Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
          <select className="input" name="status" defaultValue={tenant.subscription_status}>
            <option value="active">active</option><option value="expired">expired</option><option value="cancelled">cancelled</option>
          </select>
          <label className="label">Ends on (optional)</label>
          <input className="input" type="date" name="ends_at" />
          <SubmitButton>Update plan</SubmitButton>
        </form>
        <div className="space-y-4">
          <form action={extendTrial.bind(null, tenant.id)} className="card space-y-2">
            <h2 className="font-semibold">Extend trial</h2>
            {tenant.subscription_plan !== "trial" && <p className="text-xs text-slate-500">Only applies to tenants on the trial plan.</p>}
            <div className="flex gap-2">
              <input className="input" type="number" name="days" min={1} max={365} defaultValue={7} />
              <SubmitButton>Extend</SubmitButton>
            </div>
          </form>
          <form action={addCredits.bind(null, tenant.id)} className="card space-y-2">
            <h2 className="font-semibold">Add SMS credits (free)</h2>
            <div className="flex gap-2">
              <input className="input" type="number" name="credits" min={1} defaultValue={100} />
              <SubmitButton>Add</SubmitButton>
            </div>
          </form>
          <form action={setSmsCap.bind(null, tenant.id)} className="card space-y-2">
            <h2 className="font-semibold">Daily SMS cap</h2>
            <div className="flex gap-2">
              <input className="input" type="number" name="cap" min={1} defaultValue={tenant.sms_daily_cap} />
              <SubmitButton>Set</SubmitButton>
            </div>
          </form>
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">Users</h2>
          <ul className="space-y-1 text-sm">
            {((users ?? []) as AppUser[]).map((u) => (
              <li key={u.id} className="flex justify-between gap-2">
                <span>{u.name ?? "—"} <span className="text-slate-500">{u.email}</span></span>
                <Badge tone={u.role === "owner" ? "blue" : "slate"}>{u.role}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <form action={recordManualPayment.bind(null, tenant.id)} className="card mt-6 grid gap-2 sm:grid-cols-7">
        <h2 className="font-semibold sm:col-span-7">Record manual payment (cash / bank / personal bKash)</h2>
        <select className="input" name="kind" defaultValue="plan">
          <option value="plan">Plan</option>
          <option value="sms_pack">SMS pack</option>
        </select>
        <select className="input" name="plan" defaultValue="basic">
          <option value="basic">Basic</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
        </select>
        <select className="input" name="billing_cycle" defaultValue="monthly">
          <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
        </select>
        <input className="input" name="sms_pack_size" type="number" min={1} placeholder="SMS (packs)" />
        <input className="input" name="amount" type="number" min={0} step="0.01" placeholder="Amount ৳" required />
        <input className="input" name="reference" placeholder="Reference / receipt no." required />
        <SubmitButton pendingText="Saving…" confirm="Record this payment and activate it?">Record</SubmitButton>
      </form>

      <section className="card mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Failed reminders</h2>
          {!!failed?.length && (
            <form action={resendReminders.bind(null, { tenantId: tenant.id, back })}>
              <SubmitButton className="btn-secondary" pendingText="Queuing…">Resend all failed</SubmitButton>
            </form>
          )}
        </div>
        {!failed?.length ? <p className="text-sm text-slate-500">None.</p> : (
          <table className="table">
            <thead><tr><th>Product</th><th>Type</th><th>Channel</th><th>Expiry</th><th>Error</th><th></th></tr></thead>
            <tbody>
              {(failed as (Reminder & { products: { product_name: string } | null })[]).map((r) => (
                <tr key={r.id}>
                  <td>{r.products?.product_name}</td>
                  <td>{r.reminder_type} · {r.days_before}d</td>
                  <td>{r.channel}</td>
                  <td>{formatDate(r.expiry_date)}</td>
                  <td className="max-w-xs !whitespace-normal text-xs text-red-700">{r.last_error}</td>
                  <td>
                    <form action={resendReminders.bind(null, { reminderId: r.id, back })}>
                      <SubmitButton className="text-sm text-indigo-700 hover:underline" pendingText="…">Resend</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-semibold">Payments</h2>
          <table className="table">
            <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>TrxID</th><th>Status</th></tr></thead>
            <tbody>
              {((subs ?? []) as Subscription[]).map((s) => (
                <tr key={s.id}><td>{formatDate(s.created_at)}</td><td>{s.kind === "sms_pack" ? `${s.sms_pack_size} SMS` : `${s.plan} (${s.billing_cycle})`}</td><td>৳{s.amount}</td><td>{s.provider_trx_id ?? "—"}</td><td><StatusBadge status={s.status} /></td></tr>
              ))}
              {!subs?.length && <tr><td colSpan={5} className="text-slate-500">No payments.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2 className="mb-2 font-semibold">Recent notifications</h2>
          <ul className="space-y-2 text-xs">
            {((logs ?? []) as NotificationLog[]).map((l) => (
              <li key={l.id} className="border-b border-slate-100 pb-1">
                <div className="flex justify-between"><span>{formatDateTime(l.sent_at)} · {l.channel} → {l.recipient_phone ?? l.recipient_email}</span><StatusBadge status={l.status} /></div>
                {l.status === "failed" && <div className="truncate text-red-700">{l.provider_response}</div>}
              </li>
            ))}
            {!logs?.length && <li className="text-slate-500">None.</li>}
          </ul>
        </section>
      </div>

      <section className="card mt-6">
        <h2 className="mb-2 font-semibold">Activity log</h2>
        <ul className="space-y-1 text-xs">
          {(activity ?? []).map((a) => (
            <li key={a.id} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
              <span><span className="font-medium">{a.actor_label ?? "system"}</span> · {a.action} {a.entity} — {a.summary}</span>
              <span className="whitespace-nowrap text-slate-500">{formatDateTime(a.created_at)}</span>
            </li>
          ))}
          {!activity?.length && <li className="text-slate-500">No activity yet.</li>}
        </ul>
      </section>
    </>
  );
}
