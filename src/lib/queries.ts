import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductWithCustomer, ReminderType } from "./types";

export interface ExpiryRow {
  product: ProductWithCustomer;
  type: ReminderType;
  date: string;
}

export const PRODUCT_SELECT = "*, customers(id, name, phone, email)";

/**
 * Warranty/AMC expiries between from and to (inclusive), one row per
 * (product, type), sorted by date. RLS scopes this to the caller's tenant.
 */
export async function expiriesBetween(supabase: SupabaseClient, from: string, to: string, limit = 500): Promise<ExpiryRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("is_active", true)
    .or(
      `and(warranty_expiry_date.gte.${from},warranty_expiry_date.lte.${to}),and(amc_expiry_date.gte.${from},amc_expiry_date.lte.${to})`,
    )
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows: ExpiryRow[] = [];
  for (const p of (data ?? []) as ProductWithCustomer[]) {
    if (p.warranty_expiry_date && p.warranty_expiry_date >= from && p.warranty_expiry_date <= to)
      rows.push({ product: p, type: "warranty", date: p.warranty_expiry_date });
    if (p.amc_expiry_date && p.amc_expiry_date >= from && p.amc_expiry_date <= to)
      rows.push({ product: p, type: "amc", date: p.amc_expiry_date });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
