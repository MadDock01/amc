import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import { PRODUCT_SELECT } from "@/lib/queries";
import { publicLinkFor } from "@/lib/links";
import type { ProductWithCustomer, Reminder } from "@/lib/types";
import { ProductForm } from "@/components/product-form";
import { SubmitButton } from "@/components/submit-button";
import { Empty, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { deleteProduct, renewAmc, updateProduct } from "../actions";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const { user } = await requireTenantUser();
  const supabase = createClient();
  const { data } = await supabase.from("products").select(PRODUCT_SELECT).eq("id", params.id).maybeSingle();
  if (!data) notFound();
  const product = data as ProductWithCustomer;
  const { data: reminders } = await supabase
    .from("reminders")
    .select("*")
    .eq("product_id", product.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const link = publicLinkFor(product.public_token);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Flash searchParams={searchParams} />
        <PageHeader title={product.product_name} subtitle={`Customer: ${product.customers?.name ?? "—"}`} />
        <div className="card p-6">
          <ProductForm action={updateProduct.bind(null, product.id)} product={product} today={todayISO()} />
        </div>
      </div>
      <aside className="space-y-4">
        <div className="card">
          <h2 className="mb-2 font-semibold">Renew AMC</h2>
          <form action={renewAmc.bind(null, product.id)} className="space-y-2">
            <p className="text-xs text-slate-500">
              Starts when the current {product.amc_expiry_date ? "AMC" : "warranty"} ends (
              {formatDate(product.amc_expiry_date ?? product.warranty_expiry_date)}) unless you pick a date.
            </p>
            <input className="input" type="date" name="start" />
            <div className="flex gap-2">
              <input className="input" type="number" name="months" min={1} max={600} defaultValue={12} />
              <SubmitButton pendingText="…">Renew</SubmitButton>
            </div>
          </form>
        </div>
        {link && (
          <div className="card">
            <h2 className="mb-1 font-semibold">Customer status link</h2>
            <p className="mb-2 text-xs text-slate-500">Included in SMS. Customer can check warranty status without logging in.</p>
            <a href={link} target="_blank" className="break-all text-sm text-indigo-700 hover:underline">{link}</a>
          </div>
        )}
        <div className="card">
          <h2 className="mb-2 font-semibold">Reminder history</h2>
          {!reminders?.length ? (
            <Empty>No reminders yet. They are created automatically when expiry is 30/15/7/1 days away.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {(reminders as Reminder[]).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                  <div>
                    <div>
                      {r.reminder_type === "amc" ? "AMC" : "Warranty"} · {r.days_before}d · {r.channel}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.sent_at ? `sent ${formatDateTime(r.sent_at)}` : `scheduled ${formatDate(r.scheduled_date)}`}
                      {r.last_error && ` · ${r.last_error}`}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {user.role === "owner" && (
          <form action={deleteProduct.bind(null, product.id)} className="card">
            <h2 className="mb-2 font-semibold text-red-700">Danger zone</h2>
            <SubmitButton className="btn-danger" pendingText="Deleting…" confirm="Delete this product and its reminder history?">
              Delete product
            </SubmitButton>
          </form>
        )}
      </aside>
    </div>
  );
}
