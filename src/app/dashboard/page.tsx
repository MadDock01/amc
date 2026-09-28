import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, formatDate, todayISO } from "@/lib/dates";
import { expiriesBetween, latestOutcomes } from "@/lib/queries";
import { ExpiryTable } from "@/components/expiry-table";
import { OutcomeBadge } from "@/components/outcome";
import { Empty, Flash, PageHeader, Stat } from "@/components/ui";
import { PLANS } from "@/lib/plans";
import type { Followup } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant, user } = await requireTenantUser();
  const supabase = createClient();
  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";

  const [week, month, overdueAll, productCount, credits, sentThisMonth, failed, requests, dueFollowups] = await Promise.all([
    expiriesBetween(supabase, today, addDaysISO(today, 7)),
    expiriesBetween(supabase, addDaysISO(today, 8), addDaysISO(today, 30)),
    expiriesBetween(supabase, addDaysISO(today, -90), addDaysISO(today, -1)),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("sms_credits").select("balance").maybeSingle(),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", monthStart),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("renewal_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase
      .from("product_followups")
      .select("*, products(id, product_name, customers(name, phone))")
      .lte("next_follow_up", today)
      .order("next_follow_up")
      .limit(100),
  ]);
  const limit = PLANS[tenant.subscription_plan].productLimit;

  // Latest follow-up outcome per product: hide renewed/lost from the overdue list.
  const outcomes = await latestOutcomes(supabase, [...week, ...month, ...overdueAll].map((r) => r.product.id));
  const overdue = overdueAll.filter((r) => !["renewed", "lost"].includes(outcomes.get(r.product.id)?.outcome ?? "")).reverse();

  // A follow-up is "due" only if it's still the product's latest entry.
  const followupRows = (dueFollowups.data ?? []) as (Followup & { products: { id: string; product_name: string; customers: { name: string; phone: string | null } | null } | null })[];
  const latestForDue = await latestOutcomes(supabase, followupRows.map((f) => f.product_id));
  const due = followupRows.filter((f) => latestForDue.get(f.product_id)?.id === f.id);

  const checklist = [
    { done: Boolean(tenant.phone), label: "Add your shop mobile number (shown in customer SMS)", href: "/dashboard/settings", ownerOnly: true },
    { done: (productCount.count ?? 0) > 0, label: "Add your first product", href: "/dashboard/products/new" },
    { done: (productCount.count ?? 0) >= 10, label: "Import your old Excel sheet (CSV)", href: "/dashboard/products/import" },
    { done: (sentThisMonth.count ?? 0) > 0, label: "Your first reminder goes out automatically when an expiry is ≤ 30 days away" },
  ].filter((c) => !c.ownerOnly || user.role === "owner");
  const showChecklist = checklist.some((c) => !c.done);

  return (
    <>
      <Flash searchParams={searchParams} />
      <PageHeader
        title="Overview"
        actions={
          <>
            <Link href="/dashboard/products/import" className="btn-secondary">Import CSV</Link>
            <Link href="/dashboard/products/new" className="btn-primary">+ Add product</Link>
          </>
        }
      />
      {showChecklist && (
        <section className="card mb-6 border-indigo-200 bg-indigo-50/40">
          <h2 className="mb-2 font-semibold">Getting started</h2>
          <ul className="space-y-1 text-sm">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                <span className={c.done ? "text-emerald-600" : "text-slate-400"}>{c.done ? "✓" : "○"}</span>
                {c.href && !c.done ? <Link href={c.href} className="text-indigo-700 hover:underline">{c.label}</Link> : <span className={c.done ? "text-slate-500 line-through" : ""}>{c.label}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Products" value={productCount.count ?? 0} hint={limit ? `of ${limit} on your plan` : "unlimited"} href="/dashboard/products" />
        <Stat label="Expiring ≤ 7 days" value={week.length} tone="red" />
        <Stat label="Expiring ≤ 30 days" value={week.length + month.length} tone="yellow" />
        <Stat label="Overdue (90d)" value={overdue.length} hint="expired, not renewed" />
        <Stat label="Renewal requests" value={requests.count ?? 0} hint="from customers" href="/dashboard/requests" tone={requests.count ? "red" : undefined} />
        <Stat label="SMS credits" value={credits.data?.balance ?? 0} href={user.role === "owner" ? "/dashboard/billing" : undefined} />
        <Stat label="Reminders sent" value={sentThisMonth.count ?? 0} hint={`this month · ${failed.count ?? 0} failed`} href="/dashboard/reminders" />
      </div>

      {due.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 font-semibold text-indigo-700">Follow-ups due</h2>
          <ul className="card divide-y divide-slate-100 p-0 text-sm">
            {due.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <Link href={`/dashboard/products/${f.product_id}`} className="font-medium text-indigo-700 hover:underline">{f.products?.product_name}</Link>{" "}
                  — {f.products?.customers?.name} <OutcomeBadge outcome={f.outcome} /> <span className="text-slate-500">{f.note}</span>
                </span>
                <span className="text-xs text-slate-500">due {formatDate(f.next_follow_up)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-2 mt-8 font-semibold text-red-700">Expiring this week</h2>
      <ExpiryTable rows={week} outcomes={outcomes} empty="Nothing expires in the next 7 days." />

      <h2 className="mb-2 mt-8 font-semibold text-amber-700">Expiring later this month (8–30 days)</h2>
      <ExpiryTable rows={month} outcomes={outcomes} empty="Nothing else expires in the next 30 days." />

      <h2 className="mb-2 mt-8 font-semibold text-slate-700">Overdue / missed renewals (last 90 days)</h2>
      <p className="mb-2 text-sm text-slate-500">
        Expired and not yet renewed. Call these customers and log the outcome on the product page — renewed or lost ones drop off this list.
      </p>
      {overdue.length ? <ExpiryTable rows={overdue} outcomes={outcomes} empty="" /> : <Empty>No missed renewals. 🎉</Empty>}
    </>
  );
}
