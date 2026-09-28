import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, todayISO } from "@/lib/dates";
import { expiriesBetween } from "@/lib/queries";
import { ExpiryTable } from "@/components/expiry-table";
import { Flash, PageHeader, Stat } from "@/components/ui";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant } = await requireTenantUser();
  const supabase = createClient();
  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";

  const [week, month, overdue, productCount, credits, sentThisMonth, failed] = await Promise.all([
    expiriesBetween(supabase, today, addDaysISO(today, 7)),
    expiriesBetween(supabase, addDaysISO(today, 8), addDaysISO(today, 30)),
    expiriesBetween(supabase, addDaysISO(today, -90), addDaysISO(today, -1)),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("sms_credits").select("balance").maybeSingle(),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", monthStart),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  const limit = PLANS[tenant.subscription_plan].productLimit;

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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Products" value={productCount.count ?? 0} hint={limit ? `of ${limit} on your plan` : "unlimited"} href="/dashboard/products" />
        <Stat label="Expiring ≤ 7 days" value={week.length} tone="red" />
        <Stat label="Expiring ≤ 30 days" value={week.length + month.length} tone="yellow" />
        <Stat label="Overdue (90d)" value={overdue.length} hint="expired, not renewed" />
        <Stat label="SMS credits" value={credits.data?.balance ?? 0} href="/dashboard/billing" />
        <Stat label="Reminders sent" value={sentThisMonth.count ?? 0} hint={`this month · ${failed.count ?? 0} failed`} href="/dashboard/reminders" />
      </div>

      <h2 className="mb-2 mt-8 font-semibold text-red-700">Expiring this week</h2>
      <ExpiryTable rows={week} empty="Nothing expires in the next 7 days." />

      <h2 className="mb-2 mt-8 font-semibold text-amber-700">Expiring later this month (8–30 days)</h2>
      <ExpiryTable rows={month} empty="Nothing else expires in the next 30 days." />

      <h2 className="mb-2 mt-8 font-semibold text-slate-700">Overdue / missed renewals (last 90 days)</h2>
      <p className="mb-2 text-sm text-slate-500">
        Expired and not yet renewed. Call these customers — once renewed, edit the product&apos;s AMC dates.
      </p>
      <ExpiryTable rows={overdue.reverse()} empty="No missed renewals. 🎉" />
    </>
  );
}
