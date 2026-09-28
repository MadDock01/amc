import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { expiryTone, formatDate } from "@/lib/dates";
import type { Customer, Product } from "@/lib/types";
import { Badge, Empty, Flash, PageHeader, toneToBadge } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { deleteCustomer, updateCustomer } from "../actions";

export default async function CustomerPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const { user } = await requireTenantUser();
  const supabase = createClient();
  const { data } = await supabase.from("customers").select("*, products(*)").eq("id", params.id).maybeSingle();
  if (!data) notFound();
  const c = data as Customer & { products: Product[] };

  return (
    <div className="max-w-4xl">
      <Flash searchParams={searchParams} />
      <PageHeader title={c.name} actions={<Link href="/dashboard/products/new" className="btn-secondary">+ Add product</Link>} />
      <form action={updateCustomer.bind(null, c.id)} className="card mb-6 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Name</label><input className="input" name="name" defaultValue={c.name} required /></div>
        <div><label className="label">Mobile</label><input className="input" name="phone" defaultValue={c.phone ? "0" + c.phone.slice(3) : ""} /></div>
        <div><label className="label">Email</label><input className="input" name="email" type="email" defaultValue={c.email ?? ""} /></div>
        <div><label className="label">Address</label><input className="input" name="address" defaultValue={c.address ?? ""} /></div>
        <div><SubmitButton>Save</SubmitButton></div>
      </form>
      <h2 className="mb-2 font-semibold">Products</h2>
      {!c.products.length ? (
        <Empty>No products for this customer.</Empty>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {c.products.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <Link href={`/dashboard/products/${p.id}`} className="font-medium text-indigo-700 hover:underline">{p.product_name}</Link>
              <span className="flex gap-2">
                {p.warranty_expiry_date && <Badge tone={toneToBadge(expiryTone(p.warranty_expiry_date))}>Warranty {formatDate(p.warranty_expiry_date)}</Badge>}
                {p.amc_expiry_date && <Badge tone={toneToBadge(expiryTone(p.amc_expiry_date))}>AMC {formatDate(p.amc_expiry_date)}</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {user.role === "owner" && (
        <form action={deleteCustomer.bind(null, c.id)} className="mt-6">
          <SubmitButton className="btn-danger" pendingText="Deleting…" confirm="Delete this customer AND all their products?">Delete customer</SubmitButton>
        </form>
      )}
    </div>
  );
}
