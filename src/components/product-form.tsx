"use client";
import { useState } from "react";
import { addMonthsISO, formatDate } from "@/lib/dates";
import type { ProductWithCustomer } from "@/lib/types";
import { CustomerPicker } from "./customer-picker";
import { SubmitButton } from "./submit-button";

export function ProductForm({
  action,
  product,
  today,
}: {
  action: (fd: FormData) => void;
  product?: ProductWithCustomer;
  today: string;
}) {
  const [purchase, setPurchase] = useState(product?.purchase_date ?? today);
  const [warranty, setWarranty] = useState(String(product?.warranty_months ?? 12));
  const [amcStart, setAmcStart] = useState(product?.amc_start_date ?? "");
  const [amcMonths, setAmcMonths] = useState(product?.amc_months ? String(product.amc_months) : "");

  const wm = Number(warranty);
  const warrantyExpiry = purchase && wm > 0 ? addMonthsISO(purchase, wm) : null;
  const am = Number(amcMonths);
  const amcExpiry = amcStart && am > 0 ? addMonthsISO(amcStart, am) : null;

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label">Customer *</label>
        <CustomerPicker initial={product?.customers ? { id: product.customers.id, name: product.customers.name, phone: product.customers.phone } : null} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="label" htmlFor="product_name">Product name *</label>
          <input className="input" id="product_name" name="product_name" defaultValue={product?.product_name} placeholder="e.g. Walton 1.5 ton AC" required />
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <input className="input" id="category" name="category" list="categories" defaultValue={product?.category ?? ""} />
          <datalist id="categories">
            {["AC", "TV", "Refrigerator", "Generator", "Solar", "IPS/UPS", "Laptop", "Mobile", "Water purifier", "Insurance"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor="serial_number">Serial number</label>
          <input className="input" id="serial_number" name="serial_number" defaultValue={product?.serial_number ?? ""} />
        </div>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">Warranty</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="purchase_date">Purchase date *</label>
            <input className="input" id="purchase_date" name="purchase_date" type="date" value={purchase} onChange={(e) => setPurchase(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="warranty_months">Warranty (months)</label>
            <input className="input" id="warranty_months" name="warranty_months" type="number" min={0} max={600} value={warranty} onChange={(e) => setWarranty(e.target.value)} />
          </div>
          <div>
            <span className="label">Warranty expires</span>
            <div className="py-2 text-sm font-medium">{warrantyExpiry ? formatDate(warrantyExpiry) : "—"}</div>
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">AMC (optional)</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="amc_start_date">AMC start date</label>
            <div className="flex gap-2">
              <input className="input" id="amc_start_date" name="amc_start_date" type="date" value={amcStart} onChange={(e) => setAmcStart(e.target.value)} />
              {!amcStart && warrantyExpiry && (
                <button type="button" className="btn-secondary whitespace-nowrap text-xs" onClick={() => setAmcStart(warrantyExpiry)}>
                  After warranty
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="amc_months">AMC duration (months)</label>
            <input className="input" id="amc_months" name="amc_months" type="number" min={1} max={600} value={amcMonths} onChange={(e) => setAmcMonths(e.target.value)} />
          </div>
          <div>
            <span className="label">AMC expires</span>
            <div className="py-2 text-sm font-medium">{amcExpiry ? formatDate(amcExpiry) : "—"}</div>
          </div>
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea className="input" id="notes" name="notes" rows={2} defaultValue={product?.notes ?? ""} />
      </div>

      {product && (
        <label className="flex items-center gap-2 text-sm">
          <input type="hidden" name="is_active" value="false" />
          <input type="checkbox" name="is_active" value="true" defaultChecked={product.is_active} />
          Active (uncheck to stop reminders for this product)
        </label>
      )}

      <div className="flex gap-2">
        <SubmitButton>{product ? "Save changes" : "Save product"}</SubmitButton>
        {!product && (
          <SubmitButton className="btn-secondary" pendingText="Saving…" name="_another" value="1">
            Save &amp; add another
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
