"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasFeature } from "@/lib/plans";
import { normalizeBdPhone } from "@/lib/phone";
import { friendlyDbError, redirectWith } from "@/lib/redirect";

const BACK = "/dashboard/branches";

export async function createBranch(fd: FormData) {
  const { tenant } = await requireOwner();
  if (!hasFeature(tenant.subscription_plan, "branches")) redirectWith(BACK, { error: "Multi-branch is an Enterprise feature." });
  const parsed = z.object({ name: z.string().trim().min(1).max(120), address: z.string().trim().max(300).optional(), phone: z.string().trim().optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith(BACK, { error: "Branch name is required" });
  const phone = parsed.data.phone ? normalizeBdPhone(parsed.data.phone) : null;
  const { error } = await createClient().from("branches").insert({ name: parsed.data.name, address: parsed.data.address || null, phone });
  if (error) redirectWith(BACK, { error: error.code === "23505" ? "A branch with that name already exists." : friendlyDbError(error) });
  revalidatePath(BACK);
  redirectWith(BACK, { ok: "Branch added." });
}

export async function deleteBranch(id: string) {
  await requireOwner();
  const { error, count } = await createClient().from("branches").delete({ count: "exact" }).eq("id", id);
  if (error || !count) redirectWith(BACK, { error: error ? friendlyDbError(error) : "Branch not found" });
  revalidatePath(BACK);
  redirectWith(BACK, { ok: "Branch removed. Its products and staff are now unassigned." });
}
