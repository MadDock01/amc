"use server";

import { revalidatePath } from "next/cache";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateCustomer } from "@/lib/customers";
import { validateRow, type RawRow } from "@/lib/csv";
import { friendlyDbError } from "@/lib/redirect";

export interface ImportResult {
  line: number;
  ok: boolean;
  error?: string;
}

const MAX_ROWS_PER_CALL = 200;

/** Import one chunk of CSV rows. Runs as the user, so RLS + plan limits apply. */
export async function importChunk(rows: { line: number; raw: RawRow }[]): Promise<ImportResult[]> {
  await requireTenantUser();
  if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_CALL) {
    return [{ line: 0, ok: false, error: `Send at most ${MAX_ROWS_PER_CALL} rows per request` }];
  }
  const supabase = createClient();
  const customerCache = new Map<string, string>();
  const results: ImportResult[] = [];

  for (const { line, raw } of rows) {
    const v = validateRow(raw);
    if (!v.row) {
      results.push({ line, ok: false, error: v.error });
      continue;
    }
    const r = v.row;
    const key = r.customer_phone ?? `name:${r.customer_name.toLowerCase()}`;
    let customerId = customerCache.get(key);
    if (!customerId) {
      const c = await findOrCreateCustomer(supabase, { name: r.customer_name, phone: r.customer_phone, email: r.customer_email });
      if (!c.id) {
        results.push({ line, ok: false, error: c.error });
        continue;
      }
      customerId = c.id;
      customerCache.set(key, customerId);
    }
    const { error } = await supabase.from("products").insert({
      customer_id: customerId,
      product_name: r.product_name,
      category: r.category,
      serial_number: r.serial_number,
      purchase_date: r.purchase_date,
      warranty_months: r.warranty_months,
      amc_start_date: r.amc_start_date,
      amc_months: r.amc_months,
      notes: r.notes,
    });
    results.push(error ? { line, ok: false, error: friendlyDbError(error) } : { line, ok: true });
    // Once the plan limit is hit every following row fails the same way — stop early.
    if (error?.message.includes("Plan limit reached") || error?.message.includes("Subscription inactive")) {
      const remaining = rows.filter((x) => x.line > line);
      remaining.forEach((x) => results.push({ line: x.line, ok: false, error: "skipped: " + friendlyDbError(error) }));
      break;
    }
  }
  revalidatePath("/dashboard", "layout");
  return results;
}
