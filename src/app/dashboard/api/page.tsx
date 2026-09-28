import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/dates";
import { hasFeature } from "@/lib/plans";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { revokeApiKey } from "./actions";
import { CreateKeyForm } from "./create-key-form";

export const dynamic = "force-dynamic";

export default async function ApiPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const { tenant } = await requireOwner();
  if (!hasFeature(tenant.subscription_plan, "api")) return <Empty>API access is available on the Enterprise plan.</Empty>;
  const { data: keys } = await createClient().from("api_keys").select("*").order("created_at", { ascending: false });
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app").replace(/\/$/, "");

  return (
    <div className="max-w-4xl space-y-6">
      <Flash searchParams={searchParams} />
      <PageHeader title="API access" subtitle="Connect your POS, billing or ERP software so every sale is tracked automatically." />
      <CreateKeyForm />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(keys ?? []).map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="font-mono text-xs">{k.key_prefix}…</td>
                <td>{formatDateTime(k.created_at)}</td>
                <td>{formatDateTime(k.last_used_at)}</td>
                <td>{k.revoked_at ? <Badge tone="gray">revoked</Badge> : <Badge tone="green">active</Badge>}</td>
                <td>
                  {!k.revoked_at && (
                    <form action={revokeApiKey.bind(null, k.id)}>
                      <SubmitButton className="text-sm text-red-600 hover:underline" pendingText="…" confirm="Revoke this key? Integrations using it will stop working.">Revoke</SubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!keys?.length && <tr><td colSpan={6} className="text-center text-slate-500">No keys yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <section className="card space-y-3 text-sm">
        <h2 className="font-semibold">Reference</h2>
        <p>Send the key as <code>Authorization: Bearer amc_…</code>. All responses are JSON. Lists accept <code>page</code> and <code>per_page</code> (max 500).</p>
        <table className="table">
          <tbody>
            <tr><td className="font-mono">GET /api/v1/products?expiring_within=30</td><td>List products (optionally expiring within N days)</td></tr>
            <tr><td className="font-mono">POST /api/v1/products</td><td>Create a product; pass <code>customer_id</code> or <code>customer: {"{name, phone, email}"}</code> (matched by phone)</td></tr>
            <tr><td className="font-mono">GET /api/v1/products/:id</td><td>Product with customer and reminder history</td></tr>
            <tr><td className="font-mono">GET /api/v1/customers?phone=01…</td><td>List / look up customers</td></tr>
            <tr><td className="font-mono">POST /api/v1/customers</td><td>Create a customer (returns the existing one if the phone matches)</td></tr>
            <tr><td className="font-mono">GET /api/v1/reminders?status=sent&amp;since=2026-01-01</td><td>Reminder delivery status</td></tr>
          </tbody>
        </table>
        <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST ${base}/api/v1/products \\
  -H "Authorization: Bearer amc_…" -H "Content-Type: application/json" \\
  -d '{"customer":{"name":"Abdul Karim","phone":"01711234567"},
       "product_name":"Walton AC 1.5 ton","serial_number":"WAC123",
       "purchase_date":"2026-09-01","warranty_months":12}'`}</pre>
      </section>
    </div>
  );
}
