import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { daysBetween, formatDate, todayISO } from "@/lib/dates";
import { parseToken } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Warranty status", robots: { index: false, follow: false } };

/**
 * Public, login-free warranty status page linked from reminder SMS.
 * Looked up by an unguessable token; shows only what the customer needs
 * (no phone numbers or other customer data).
 */
export default async function WarrantyStatus({ params }: { params: { token: string } }) {
  const token = parseToken(params.token);
  if (!token) notFound();
  const { data } = await createAdminClient()
    .from("products")
    .select("product_name, serial_number, purchase_date, warranty_expiry_date, amc_expiry_date, is_active, customers(name), tenants(business_name, phone, address)")
    .eq("public_token", token)
    .maybeSingle();
  if (!data) notFound();
  const p = data as unknown as {
    product_name: string; serial_number: string | null; purchase_date: string;
    warranty_expiry_date: string | null; amc_expiry_date: string | null; is_active: boolean;
    customers: { name: string } | null; tenants: { business_name: string; phone: string | null; address: string | null } | null;
  };
  const today = todayISO();
  const row = (label: string, date: string | null) => {
    if (!date) return null;
    const left = daysBetween(today, date);
    return (
      <div className="flex items-center justify-between border-t py-3">
        <span className="text-slate-600">{label}</span>
        <span className="text-right">
          <span className="font-medium">{formatDate(date)}</span>
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${left < 0 ? "bg-slate-200 text-slate-600" : left <= 30 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {left < 0 ? "expired" : left === 0 ? "expires today" : `${left} days left`}
          </span>
        </span>
      </div>
    );
  };
  const shopPhone = p.tenants?.phone ? "0" + p.tenants.phone.slice(3) : null;

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="card p-6">
        <div className="text-sm text-slate-500">{p.tenants?.business_name}</div>
        <h1 className="mt-1 text-xl font-semibold">{p.product_name}</h1>
        {p.customers && <div className="text-sm text-slate-600">For {p.customers.name}</div>}
        {p.serial_number && <div className="text-xs text-slate-500">Serial: {p.serial_number}</div>}
        <div className="mt-4">
          <div className="flex items-center justify-between py-3">
            <span className="text-slate-600">Purchased</span>
            <span className="font-medium">{formatDate(p.purchase_date)}</span>
          </div>
          {row("Warranty until", p.warranty_expiry_date)}
          {row("AMC until", p.amc_expiry_date)}
        </div>
        {shopPhone && (
          <a href={`tel:${shopPhone}`} className="btn-primary mt-4 w-full">Call {p.tenants?.business_name} to renew</a>
        )}
        {p.tenants?.address && <p className="mt-3 text-center text-xs text-slate-500">{p.tenants.address}</p>}
      </div>
    </main>
  );
}
