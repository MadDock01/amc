import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { monthRangePublic } from "@/lib/month";
import { expiriesBetween } from "@/lib/queries";
import { ExpiryTable } from "@/components/expiry-table";
import { PrintButton } from "@/components/print-button";
import { PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: { month?: string } }) {
  const { tenant } = await requireTenantUser();
  const supabase = createClient();
  const month = searchParams.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month) ? searchParams.month : todayISO().slice(0, 7);
  const { from, to } = monthRangePublic(month);
  const fromTs = `${from}T00:00:00+06:00`;
  const toTs = `${to}T23:59:59+06:00`;

  const [expiring, added, sent, failed, sms, renewed] = await Promise.all([
    expiriesBetween(supabase, from, to, 2000),
    supabase.from("products").select("id", { count: "exact", head: true }).gte("created_at", fromTs).lte("created_at", toTs),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", fromTs).lte("sent_at", toTs),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", fromTs).lte("created_at", toTs),
    supabase.from("notification_logs").select("sms_segments").eq("channel", "sms").eq("status", "sent").gte("sent_at", fromTs).lte("sent_at", toTs).limit(10000),
    supabase.from("products").select("id", { count: "exact", head: true }).gte("amc_start_date", from).lte("amc_start_date", to),
  ]);
  const smsUsed = (sms.data ?? []).reduce((s, r) => s + (r.sms_segments ?? 0), 0);
  const monthLabel = new Date(from + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title={`Monthly report — ${monthLabel}`}
        subtitle={tenant.business_name}
        actions={
          <>
            <form className="flex gap-2" action="/dashboard/reports">
              <input className="input w-auto" type="month" name="month" defaultValue={month} />
              <button className="btn-secondary">Show</button>
            </form>
            <a className="btn-secondary" href={`/api/export/products?month=${month}`}>Expiries CSV</a>
            <a className="btn-secondary" href={`/api/export/reminders?month=${month}`}>Reminder log CSV</a>
            <PrintButton />
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Expiring this month" value={expiring.length} />
        <Stat label="Warranty" value={expiring.filter((e) => e.type === "warranty").length} />
        <Stat label="AMC" value={expiring.filter((e) => e.type === "amc").length} />
        <Stat label="AMC started/renewed" value={renewed.count ?? 0} />
        <Stat label="Reminders sent" value={sent.count ?? 0} hint={`${failed.count ?? 0} failed`} />
        <Stat label="SMS used" value={smsUsed} hint={`${added.count ?? 0} products added`} />
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Warranty / AMC expiring in {monthLabel}</h2>
      <ExpiryTable rows={expiring} empty="Nothing expires this month." />
    </>
  );
}
