import "server-only";
import { createClient } from "./supabase/server";
import { hasFeature } from "./plans";
import type { AppUser, Branch, Tenant } from "./types";

/** Branches the user may assign products to (empty = feature off or branch-scoped user). */
export async function assignableBranches(tenant: Tenant, user: AppUser): Promise<Branch[]> {
  if (!hasFeature(tenant.subscription_plan, "branches") || user.branch_id) return [];
  const { data } = await createClient().from("branches").select("*").order("name");
  return (data ?? []) as Branch[];
}
