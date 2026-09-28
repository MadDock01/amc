import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBdPhone } from "./phone";

/**
 * Find a customer by phone within the caller's tenant (RLS), or create it.
 * Returns the customer id.
 */
export async function findOrCreateCustomer(
  supabase: SupabaseClient,
  c: { name: string; phone?: string | null; email?: string | null; address?: string | null },
): Promise<{ id?: string; error?: string }> {
  const phone = normalizeBdPhone(c.phone);
  if (c.phone && !phone) return { error: `Invalid mobile number: ${c.phone}` };
  if (phone) {
    const { data: existing } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
    if (existing) return { id: existing.id };
  }
  const { data, error } = await supabase
    .from("customers")
    .insert({ name: c.name.trim(), phone, email: c.email?.trim() || null, address: c.address?.trim() || null })
    .select("id")
    .single();
  if (error) {
    // Lost a race with a concurrent insert of the same phone → re-read.
    if (error.code === "23505" && phone) {
      const { data: again } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
      if (again) return { id: again.id };
    }
    return { error: error.message };
  }
  return { id: data.id };
}
