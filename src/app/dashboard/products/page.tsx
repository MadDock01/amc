import Link from "next/link";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, daysBetween, expiryTone, formatDate, nextExpiry, todayISO } from "@/lib/dates";
import { displayPhone } from "@/lib/phone";
import { PRODUCT_SELECT } from "@/lib/queries";
import type { ProductWithCustomer } from "@/lib/types";
import { Badge, Empty, Flash, PageHeader, toneToBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
type Filter = "all" | "7" | "30" | "expired" | "inactive";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { q?: string; filter?: Filter; sort?: "expiry" | "recent" | "name"; page?: string; ok?: string; error?: string };
}) {
  await requireTenantUser();
  const supabase = createClient();
  const today = todayISO();
  const filter: Filter = searchParams.filter ?? "all";
  const sort = searchParams.sort ?? "expiry";
  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = (searchParams.q ?? "").trim().replace(/[%,()]/g, " ");

  let query = supabase.from("products").select(PRODUCT_SELECT, { count: "exact" });
  query = filter === "inactive" ? query.eq("is_active", false) : query.eq("is_active", true);

  const range = (from: string, to: string) =>
    `and(warranty_expiry_date.gte.${from},warranty_expiry_date.lte.${to}),and(amc_expiry_date.gte.${from},amc_expiry_date.lte.${to})`;
  if (filter === "7") query = query.or(range(today, addDaysISO(today, 7)));
  if (filter === "30") query = query.or(range(today, addDaysISO(today, 30)));
  if (filter === "expired") {
    // nothing still running: warranty over and AMC over (or absent)
    query = query
      .or(`warranty_expiry_date.lt.${today},warranty_expiry_date.is.null`)
      .or(`amc_expiry_date.lt.${today},amc_expiry_date.is.null`);
  }

  if (q) {
    // search by product / serial, or by customer name / phone
    const { data: custs } = await supabase
      .from("customers")
      .select("id")
      .or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/^0/, "")}%`)
      .limit(200);
    const ids = (custs ?? []).map((c) => c.id);
    const clauses = [`product_name.ilike.%${q}%`, `serial_number.ilike.%${q}%`, `category.ilike.%${q}%`];
    if (ids.length) clauses.push(`customer_id.in.(${ids.join(",")})`);
    query = query.or(clauses.join(","));
  }

  if (sort === "recent") query = query.order("created_at", { ascending: false });
  else if (sort === "name") query = query.order("product_name");
  else
    query = query
      .order("warranty_expiry_date", { ascending: true, nullsFirst: false })
      .order("amc_expiry_date", { ascending: true, nullsFirst: false });

  const { data, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  let products = (data ?? []) as ProductWithCustomer[];
  // In "expiry" order sort by the *next* relevant date (warranty or AMC).
  if (sort === "expiry") {
    products = [...products].sort((a, b) => (nextExpiry(a, today)?.date ?? "9999").localeCompare(nextExpiry(b, today)?.date ?? "9999"));
  }
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: searchParams.q, filter, sort, ...over };
    Object.entries(merged).forEach(([k, v]) => v && v !== "all" && p.set(k, v));
    return `/dashboard/products?${p.toString()}`;
  };

  return (
    <>
      <Flash searchParams={searchParams} />
      <PageHeader
        title="Products"
        subtitle={`${count ?? 0} product(s)`}
        actions={
          <>
            <a href="/api/export/products" className="btn-secondary">Export CSV</a>
            <Link href="/dashboard/products/import" className="btn-secondary">Import CSV</Link>
            <Link href="/dashboard/products/new" className="btn-primary">+ Add product</Link>
          </>
        }
      />

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/dashboard/products">
        <input className="input max-w-xs" name="q" placeholder="Search product, serial, customer, mobile…" defaultValue={searchParams.q} />
        <input type="hidden" name="filter" value={filter} />
        <select className="input w-auto" name="sort" defaultValue={sort}>
          <option value="expiry">Sort: next expiry</option>
          <option value="recent">Sort: recently added</option>
          <option value="name">Sort: name</option>
        </select>
        <button className="btn-secondary">Search</button>
      </form>

      <div className="mb-3 flex flex-wrap gap-1 text-sm">
        {(
          [
            ["all", "All active"],
            ["7", "≤ 7 days"],
            ["30", "≤ 30 days"],
            ["expired", "Expired"],
            ["inactive", "Archived"],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <Link
            key={k}
            href={link({ filter: k, page: undefined })}
            className={`rounded-full border px-3 py-1 ${filter === k ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {!products.length ? (
        <Empty>
          No products found. <Link href="/dashboard/products/new" className="text-indigo-700 underline">Add your first product</Link> or{" "}
          <Link href="/dashboard/products/import" className="text-indigo-700 underline">import a CSV</Link>.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Customer</th>
                <th>Purchased</th>
                <th>Warranty until</th>
                <th>AMC until</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const next = nextExpiry(p, today);
                const tone = expiryTone(next?.date ?? null, today);
                const left = next ? daysBetween(today, next.date) : null;
                return (
                  <tr key={p.id} className={tone === "red" ? "bg-red-50/60" : tone === "yellow" ? "bg-amber-50/60" : ""}>
                    <td>
                      <Link href={`/dashboard/products/${p.id}`} className="font-medium text-indigo-700 hover:underline">
                        {p.product_name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {[p.category, p.serial_number && `SN ${p.serial_number}`].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>
                      {p.customers?.name}
                      <div className="text-xs text-slate-500">{displayPhone(p.customers?.phone)}</div>
                    </td>
                    <td>{formatDate(p.purchase_date)}</td>
                    <td>
                      <Badge tone={toneToBadge(expiryTone(p.warranty_expiry_date, today))}>{formatDate(p.warranty_expiry_date)}</Badge>
                    </td>
                    <td>
                      {p.amc_expiry_date ? (
                        <Badge tone={toneToBadge(expiryTone(p.amc_expiry_date, today))}>{formatDate(p.amc_expiry_date)}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-xs text-slate-600">
                      {left === null ? "—" : left < 0 ? "Expired" : `${next!.type === "amc" ? "AMC" : "Warranty"} in ${left}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn-secondary" href={link({ page: String(page - 1) })}>Previous</Link>}
            {page < pages && <Link className="btn-secondary" href={link({ page: String(page + 1) })}>Next</Link>}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        <Badge tone="red">red</Badge> expires within 7 days · <Badge tone="yellow">yellow</Badge> within 30 days · <Badge tone="gray">grey</Badge> expired
      </p>
    </>
  );
}
