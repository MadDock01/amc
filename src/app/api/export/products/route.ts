import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse, monthRange } from "@/lib/export";
import { PRODUCT_SELECT } from "@/lib/queries";
import type { ProductWithCustomer } from "@/lib/types";

export const dynamic = "force-dynamic";

/** CSV of the caller's products (RLS-scoped). ?month=YYYY-MM limits to expiries in that month. */
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const month = monthRange(req.nextUrl.searchParams.get("month"));
  const all: ProductWithCustomer[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("products").select(PRODUCT_SELECT).order("created_at").range(from, from + 999);
    if (month) {
      q = q.or(
        `and(warranty_expiry_date.gte.${month.from},warranty_expiry_date.lte.${month.to}),and(amc_expiry_date.gte.${month.from},amc_expiry_date.lte.${month.to})`,
      );
    }
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    all.push(...((data ?? []) as ProductWithCustomer[]));
    if (!data || data.length < 1000) break;
  }

  return csvResponse(
    `products${month ? "-" + req.nextUrl.searchParams.get("month") : ""}.csv`,
    ["customer_name", "customer_phone", "customer_email", "product_name", "category", "serial_number", "purchase_date",
     "warranty_months", "warranty_expiry_date", "amc_start_date", "amc_months", "amc_expiry_date", "active", "notes"],
    all.map((p) => [
      p.customers?.name, p.customers?.phone ? "0" + p.customers.phone.slice(3) : "", p.customers?.email, p.product_name, p.category,
      p.serial_number, p.purchase_date, p.warranty_months, p.warranty_expiry_date, p.amc_start_date, p.amc_months,
      p.amc_expiry_date, p.is_active ? "yes" : "no", p.notes,
    ]),
  );
}
