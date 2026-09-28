"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/api-keys";
import { hasFeature } from "@/lib/plans";
import { redirectWith } from "@/lib/redirect";

export type CreateKeyState = { key?: string; error?: string } | undefined;

export async function createApiKey(_: CreateKeyState, fd: FormData): Promise<CreateKeyState> {
  const { tenant, user } = await requireOwner();
  if (!hasFeature(tenant.subscription_plan, "api")) return { error: "API access requires the Enterprise plan." };
  const name = z.string().trim().min(1).max(100).safeParse(fd.get("name"));
  if (!name.success) return { error: "Give the key a name (e.g. “POS integration”)." };
  const { key, prefix, hash } = generateApiKey();
  const { error } = await createAdminClient()
    .from("api_keys")
    .insert({ tenant_id: tenant.id, name: name.data, key_prefix: prefix, key_hash: hash, created_by: user.id });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/api");
  // Shown exactly once; only the hash is stored.
  return { key };
}

export async function revokeApiKey(id: string) {
  const { tenant } = await requireOwner();
  const { error, count } = await createAdminClient()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .is("revoked_at", null);
  if (error || !count) redirectWith("/dashboard/api", { error: error?.message ?? "Key not found" });
  revalidatePath("/dashboard/api");
  redirectWith("/dashboard/api", { ok: "Key revoked." });
}
