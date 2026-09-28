import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import type { NotificationLog, Reminder } from "@/lib/types";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

type Row = Reminder & { products: { id: string; product_name: string; customers: { name: string } | null } | null };

export default async function RemindersPage({ searchParams }: { searchParams: { tab?: "reminders" | "log"; status?: string; page?: string } }) {
  await requireTenantUser();
  const supabase = createClient();
  const tab = searchParams.tab ?? "reminders";
  const page = Math.max(1, Number(searchParams.page) || 1);
  const status = searchParams.status;

  const tabLink = (t: string, extra = "") => `/dashboard/reminders?tab=${t}${extra}`;

  return (
    <>
      <PageHeader
        title="Reminders"
        subtitle="Reminders are generated daily for expiries 30, 15, 7 and 1 day(s) away, then sent by SMS/email."
        actions={<a className="btn-secondary" href="/api/export/reminders">Export CSV</a>}
      />
      <div className="mb-4 flex gap-1 text-sm">
        <Link href={tabLink("reminders")} className={`rounded-md px-3 py-1.5 ${tab === "reminders" ? "bg-indigo-600 text-white" : "bg-white text-slate-700"}`}>Reminders</Link>
        <Link href={tabLink("log")} className={`rounded-md px-3 py-1.5 ${tab === "log" ? "bg-indigo-600 text-white" : "bg-white text-slate-700"}`}>Delivery log</Link>
      </div>
      {tab === "reminders" ? <RemindersTable status={status} page={page} /> : <LogTable page={page} />}
    </>
  );

  async function RemindersTable({ status, page }: { status?: string; page: number }) {
    let q = supabase
      .from("reminders")
      .select("*, products(id, product_name, customers(name))", { count: "exact" })
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, count } = await q.range((page - 1) * 50, page * 50 - 1);
    const rows = (data ?? []) as Row[];
    return (
      <>
        <div className="mb-3 flex flex-wrap gap-1 text-xs">
          {["", "pending", "sent", "failed", "cancelled"].map((s) => (
            <Link key={s} href={tabLink("reminders", s ? `&status=${s}` : "")} className={`rounded-full border px-3 py-1 ${(status ?? "") === s ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white"}`}>
              {s || "all"}
            </Link>
          ))}
        </div>
        {!rows.length ? (
          <Empty>No reminders yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="table">
              <thead>
                <tr><th>Product</th><th>Customer</th><th>Type</th><th>Window</th><th>Channel</th><th>Expiry</th><th>Status</th><th>Sent / note</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.products ? <Link href={`/dashboard/products/${r.products.id}`} className="text-indigo-700 hover:underline">{r.products.product_name}</Link> : "—"}</td>
                    <td>{r.products?.customers?.name ?? "—"}</td>
                    <td>{r.reminder_type === "amc" ? "AMC" : "Warranty"}</td>
                    <td>{r.days_before} days</td>
                    <td>{r.channel}</td>
                    <td>{formatDate(r.expiry_date)}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="max-w-xs !whitespace-normal text-xs text-slate-600">
                      {r.sent_at ? formatDateTime(r.sent_at) : r.status === "pending" && r.attempts ? `retry ${r.attempts}, next ${formatDateTime(r.next_attempt_at)}` : ""}
                      {r.last_error && <div className="text-red-700">{r.last_error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(count ?? 0) > page * 50 && <Link className="btn-secondary mt-4" href={tabLink("reminders", `${status ? `&status=${status}` : ""}&page=${page + 1}`)}>Next page</Link>}
      </>
    );
  }

  async function LogTable({ page }: { page: number }) {
    const { data, count } = await supabase
      .from("notification_logs")
      .select("*", { count: "exact" })
      .order("sent_at", { ascending: false })
      .range((page - 1) * 50, page * 50 - 1);
    const rows = (data ?? []) as NotificationLog[];
    if (!rows.length) return <Empty>No messages sent yet.</Empty>;
    return (
      <>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr><th>When</th><th>To</th><th>Channel</th><th>Message</th><th>SMS parts</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>{formatDateTime(l.sent_at)}</td>
                  <td>{l.recipient_phone ? displayPhone(l.recipient_phone) : l.recipient_email}</td>
                  <td>{l.channel}</td>
                  <td className="max-w-md !whitespace-normal text-xs">{l.message_content}</td>
                  <td>{l.sms_segments || "—"}</td>
                  <td><StatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(count ?? 0) > page * 50 && <Link className="btn-secondary mt-4" href={tabLink("log", `&page=${page + 1}`)}>Next page</Link>}
      </>
    );
  }
}
