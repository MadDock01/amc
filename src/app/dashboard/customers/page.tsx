import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import { Empty, Flash, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createCustomer } from "./actions";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string; page?: string; ok?: string; error?: string } }) {
  await requireTenantUser();
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, " ");
  let query = supabase.from("customers").select("*, products(count)", { count: "exact" }).order("name");
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/^0/, "")}%,email.ilike.%${q}%`);
  const { data, count } = await query.range((page - 1) * 50, page * 50 - 1);
  const customers = (data ?? []) as { id: string; name: string; phone: string | null; email: string | null; created_at: string; products: { count: number }[] }[];

  return (
    <>
      <Flash searchParams={searchParams} />
      <PageHeader title="Customers" subtitle={`${count ?? 0} customer(s)`} actions={<a className="btn-secondary" href="/api/export/customers">Export CSV</a>} />
      <details className="card mb-4">
        <summary className="cursor-pointer text-sm font-medium">+ Add customer</summary>
        <form action={createCustomer} className="mt-3 grid gap-3 sm:grid-cols-5">
          <input className="input" name="name" placeholder="Name *" required />
          <input className="input" name="phone" placeholder="Mobile 01XXXXXXXXX" />
          <input className="input" name="email" type="email" placeholder="Email" />
          <input className="input" name="address" placeholder="Address" />
          <SubmitButton>Add</SubmitButton>
        </form>
      </details>
      <form className="mb-4 flex gap-2" action="/dashboard/customers">
        <input className="input max-w-xs" name="q" defaultValue={searchParams.q} placeholder="Search name, mobile, email…" />
        <button className="btn-secondary">Search</button>
      </form>
      {!customers.length ? (
        <Empty>No customers yet. They are also created automatically when you add a product.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Mobile</th><th>Email</th><th>Products</th><th>Added</th></tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/dashboard/customers/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.name}</Link></td>
                  <td>{displayPhone(c.phone)}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.products?.[0]?.count ?? 0}</td>
                  <td>{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(count ?? 0) > page * 50 && (
        <Link className="btn-secondary mt-4" href={`/dashboard/customers?page=${page + 1}${searchParams.q ? `&q=${encodeURIComponent(searchParams.q)}` : ""}`}>Next page</Link>
      )}
    </>
  );
}
