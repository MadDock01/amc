"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeBdPhone } from "@/lib/phone";
import { friendlyDbError, redirectWith } from "@/lib/redirect";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Invalid email")]).optional(),
  address: z.string().trim().max(500).optional(),
});

function values(fd: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const phone = d.phone ? normalizeBdPhone(d.phone) : null;
  if (d.phone && !phone) return { error: "Enter a valid Bangladeshi mobile number" };
  return { row: { name: d.name, phone, email: d.email || null, address: d.address || null } };
}

export async function createCustomer(fd: FormData) {
  await requireTenantUser();
  const v = values(fd);
  if (!v.row) redirectWith("/dashboard/customers", { error: v.error });
  const { error } = await createClient().from("customers").insert(v.row);
  if (error) redirectWith("/dashboard/customers", { error: friendlyDbError(error) });
  revalidatePath("/dashboard/customers");
  redirectWith("/dashboard/customers", { ok: `Added ${v.row.name}` });
}

export async function updateCustomer(id: string, fd: FormData) {
  await requireTenantUser();
  const back = `/dashboard/customers/${id}`;
  const v = values(fd);
  if (!v.row) redirectWith(back, { error: v.error });
  const { error } = await createClient().from("customers").update(v.row).eq("id", id);
  if (error) redirectWith(back, { error: friendlyDbError(error) });
  revalidatePath("/dashboard", "layout");
  redirectWith(back, { ok: "Saved." });
}

export async function deleteCustomer(id: string) {
  await requireOwner();
  const { error, count } = await createClient().from("customers").delete({ count: "exact" }).eq("id", id);
  if (error || !count) redirectWith(`/dashboard/customers/${id}`, { error: error ? friendlyDbError(error) : "Not allowed" });
  revalidatePath("/dashboard", "layout");
  redirectWith("/dashboard/customers", { ok: "Customer and their products deleted." });
}
