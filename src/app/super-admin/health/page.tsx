import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import type { NotificationLog } from "@/lib/types";
import { Flash, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { resendReminders, runJobNow } from "../actions";

export const dynamic = "force-dynamic";

export default async function HealthPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const supabase = createClient();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [runs, pending, oldestPending, failedReminders, failed24, failed7, sent24, failedLogs] = await Promise.all([
    supabase.from("cron_runs").select("*").order("started_at", { ascending: false }).limit(20),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("reminders").select("next_attempt_at").eq("status", "pending").order("next_attempt_at").limit(1).maybeSingle(),
    supabase.from("reminders").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("notification_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("sent_at", dayAgo),
    supabase.from("notification_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("sent_at", weekAgo),
    supabase.from("notification_logs").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", dayAgo),
    supabase.from("notification_logs").select("*, tenants(business_name)").eq("status", "failed").order("sent_at", { ascending: false }).limit(30),
  ]);
  const lastDaily = (runs.data ?? []).find((r) => r.job === "daily-reminders");
  const stale = !lastDaily || Date.now() - new Date(lastDaily.started_at).getTime() > 26 * 3600_000;

  return (
    <>
      <Flash searchParams={searchParams} />
      <PageHeader
        title="System health"
        actions={
          <>
            <form action={runJobNow.bind(null, "send")}><SubmitButton className="btn-secondary" pendingText="Running…">Run send now</SubmitButton></form>
            <form action={runJobNow.bind(null, "daily")}><SubmitButton pendingText="Running…" confirm="Run the full daily job now (generate + send)?">Run daily job now</SubmitButton></form>
          </>
        }
      />
      {stale && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          The daily reminder job hasn&apos;t run in the last 26 hours. Check the cron (vercel.json / crontab) and CRON_SECRET.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Last daily run" value={lastDaily ? <StatusBadge status={lastDaily.status} /> : "never"} hint={formatDateTime(lastDaily?.started_at)} tone={stale ? "red" : undefined} />
        <Stat label="Queue (pending)" value={pending.count ?? 0} hint={oldestPending.data ? `next ${formatDateTime(oldestPending.data.next_attempt_at)}` : undefined} />
        <Stat label="Failed reminders" value={failedReminders.count ?? 0} tone={failedReminders.count ? "red" : undefined} />
        <Stat label="Sent (24h)" value={sent24.count ?? 0} />
        <Stat label="Failed sends (24h)" value={failed24.count ?? 0} tone={failed24.count ? "red" : undefined} />
        <Stat label="Failed sends (7d)" value={failed7.count ?? 0} />
      </div>
      {!!failedReminders.count && (
        <form action={resendReminders.bind(null, { back: "/super-admin/health" })} className="mt-3">
          <SubmitButton className="btn-secondary" pendingText="Queuing…" confirm="Re-queue ALL failed reminders across every tenant?">
            Resend all failed reminders (all tenants)
          </SubmitButton>
        </form>
      )}

      <section className="card mt-6">
        <h2 className="mb-2 font-semibold">Recent job runs</h2>
        <table className="table">
          <thead><tr><th>Job</th><th>Started</th><th>Duration</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.job}</td>
                <td>{formatDateTime(r.started_at)}</td>
                <td>{r.finished_at ? `${((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000).toFixed(1)}s` : "—"}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="max-w-lg !whitespace-normal font-mono text-xs">{r.details ? JSON.stringify(r.details) : ""}</td>
              </tr>
            ))}
            {!runs.data?.length && <tr><td colSpan={5} className="text-slate-500">No runs recorded yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card mt-6">
        <h2 className="mb-2 font-semibold">Recent failed sends (error log)</h2>
        <table className="table">
          <thead><tr><th>When</th><th>Shop</th><th>Channel</th><th>To</th><th>Provider response</th></tr></thead>
          <tbody>
            {((failedLogs.data ?? []) as (NotificationLog & { tenants: { business_name: string } | null })[]).map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.sent_at)}</td>
                <td>{l.tenant_id ? <Link className="text-indigo-700 hover:underline" href={`/super-admin/tenants/${l.tenant_id}`}>{l.tenants?.business_name}</Link> : "—"}</td>
                <td>{l.channel}</td>
                <td>{l.recipient_phone ?? l.recipient_email}</td>
                <td className="max-w-lg !whitespace-normal font-mono text-xs text-red-700">{l.provider_response}</td>
              </tr>
            ))}
            {!failedLogs.data?.length && <tr><td colSpan={5} className="text-slate-500">No failures. 🎉</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
