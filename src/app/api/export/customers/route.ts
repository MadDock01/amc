import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse } from "@/lib/export";

export const dynamic = "force-dynamic";

/** CSV of the caller's customers (RLS-scoped). */
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows: { name: string; phone: string | null; email: string | null; address: string | null; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("customers").select("name, phone, email, address, created_at").order("name").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return csvResponse(
    "customers.csv",
    ["name", "phone", "email", "address", "created_at"],
    rows.map((c) => [c.name, c.phone ? "0" + c.phone.slice(3) : "", c.email, c.address, c.created_at]),
  );
}
