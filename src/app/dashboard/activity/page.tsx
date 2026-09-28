import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ENTITY_LABEL: Record<string, string> = {
  products: "product", customers: "customer", branches: "branch", product_followups: "follow-up", tenant: "account",
};

export default async function ActivityPage({ searchParams }: { searchParams: { page?: string } }) {
  await requireOwner();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const { data, count } = await createClient()
    .from("activity_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * 100, page * 100 - 1);

  return (
    <>
      <PageHeader title="Activity log" subtitle="Who added, changed or deleted what — including changes made by staff, the API and platform support." />
      {!data?.length ? <Empty>No activity yet.</Empty> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.created_at)}</td>
                  <td>{a.actor_label ?? "system"}</td>
                  <td>{a.action} {ENTITY_LABEL[a.entity ?? ""] ?? a.entity}</td>
                  <td className="!whitespace-normal">
                    {a.entity === "products" && a.action !== "delete" && a.entity_id ? (
                      <Link className="text-indigo-700 hover:underline" href={`/dashboard/products/${a.entity_id}`}>{a.summary}</Link>
                    ) : a.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(count ?? 0) > page * 100 && <Link className="btn-secondary mt-4" href={`/dashboard/activity?page=${page + 1}`}>Older</Link>}
    </>
  );
}
