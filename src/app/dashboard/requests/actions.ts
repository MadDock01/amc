"use server";

import { revalidatePath } from "next/cache";
import { requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirectWith } from "@/lib/redirect";

export async function markHandled(id: string) {
  const { user } = await requireTenantUser();
  const { error } = await createClient()
    .from("renewal_requests")
    .update({ status: "handled", handled_by: user.id, handled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) redirectWith("/dashboard/requests", { error: error.message });
  revalidatePath("/dashboard", "layout");
  redirectWith("/dashboard/requests", { ok: "Marked as handled." });
}
