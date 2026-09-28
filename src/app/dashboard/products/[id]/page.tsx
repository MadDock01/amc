import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/auth";
import { assignableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, todayISO } from "@/lib/dates";
import { PRODUCT_SELECT } from "@/lib/queries";
import { publicLinkFor } from "@/lib/links";
import type { Followup, ProductWithCustomer, Reminder } from "@/lib/types";
import { ProductForm } from "@/components/product-form";
import { SubmitButton } from "@/components/submit-button";
import { OutcomeBadge, OUTCOME_LABELS } from "@/components/outcome";
import { Empty, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { addFollowup, deleteProduct, renewAmc, sendNow, updateProduct } from "../actions";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const { user, tenant } = await requireTenantUser();
  const supabase = createClient();
  const { data } = await supabase.from("products").select(PRODUCT_SELECT).eq("id", params.id).maybeSingle();
  if (!data) notFound();
  const product = data as ProductWithCustomer;
  const [{ data: reminders }, { data: followups }, branches] = await Promise.all([
    supabase.from("reminders").select("*").eq("product_id", product.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("product_followups").select("*, users(name, email)").eq("product_id", product.id).order("created_at", { ascending: false }).limit(50),
    assignableBranches(tenant, user),
  ]);
  const link = publicLinkFor(product.public_token);
  const today = todayISO();
  const hasAmc = Boolean(product.amc_expiry_date);
  const defaultType = hasAmc && (!product.warranty_expiry_date || product.warranty_expiry_date < today) ? "amc" : "warranty";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <Flash searchParams={searchParams} />
          <PageHeader title={product.product_name} subtitle={`Customer: ${product.customers?.name ?? "—"}`} />
          <div className="card p-6">
            <ProductForm action={updateProduct.bind(null, product.id)} product={product} today={today} branches={branches} />
          </div>
        </div>

        <section className="card">
          <h2 className="mb-3 font-semibold">Renewal follow-ups</h2>
          <form key={followups?.length ?? 0} action={addFollowup.bind(null, product.id)} className="mb-4 grid gap-2 sm:grid-cols-4">
            <select className="input" name="outcome" defaultValue="contacted">
              {Object.entries(OUTCOME_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input className="input sm:col-span-2" name="note" placeholder="Note (what did the customer say?)" />
            <input className="input" type="date" name="next_follow_up" title="Next follow-up date" />
            <div className="sm:col-span-4"><SubmitButton>Log follow-up</SubmitButton></div>
          </form>
          {!followups?.length ? (
            <Empty>No follow-ups yet. Log calls here so everyone on the team knows where each renewal stands.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {(followups as (Followup & { users: { name: string | null; email: string | null } | null })[]).map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                  <div>
                    <OutcomeBadge outcome={f.outcome} /> <span className="ml-1">{f.note}</span>
                    <div className="text-xs text-slate-500">
                      {formatDateTime(f.created_at)} · {f.users?.name ?? f.users?.email ?? "—"}
                      {f.next_follow_up && ` · next follow-up ${formatDate(f.next_follow_up)}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <div className="card">
          <h2 className="mb-2 font-semibold">Send reminder now</h2>
          <form action={sendNow.bind(null, product.id)} className="space-y-2 text-sm">
            <div className="flex gap-3">
              {product.warranty_expiry_date && (
                <label className="flex items-center gap-1">
                  <input type="radio" name="type" value="warranty" defaultChecked={defaultType === "warranty"} /> Warranty ({formatDate(product.warranty_expiry_date)})
                </label>
              )}
              {hasAmc && (
                <label className="flex items-center gap-1">
                  <input type="radio" name="type" value="amc" defaultChecked={defaultType === "amc"} /> AMC ({formatDate(product.amc_expiry_date)})
                </label>
              )}
            </div>
            <div className="flex gap-3">
              <label className="flex items-center gap-1"><input type="checkbox" name="channel" value="sms" defaultChecked /> SMS</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="channel" value="email" /> Email</label>
              {tenant.whatsapp_enabled && <label className="flex items-center gap-1"><input type="checkbox" name="channel" value="whatsapp" /> WhatsApp</label>}
            </div>
            <SubmitButton className="btn-secondary" pendingText="Sending…" confirm="Send a reminder to this customer now? SMS uses credits.">Send now</SubmitButton>
          </form>
        </div>
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
            <p className="mb-2 text-xs text-slate-500">Included in SMS. The customer can check status and request a renewal call without logging in.</p>
            <a href={link} target="_blank" className="break-all text-sm text-indigo-700 hover:underline">{link}</a>
          </div>
        )}
        <div className="card">
          <h2 className="mb-2 font-semibold">Reminder history</h2>
          {!reminders?.length ? (
            <Empty>No reminders yet. They are created automatically as expiry approaches.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {(reminders as Reminder[]).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                  <div>
                    <div>
                      {r.reminder_type === "amc" ? "AMC" : "Warranty"} · {r.is_manual ? "manual" : `${r.days_before}d`} · {r.channel}
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
