"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PLANS } from "@/lib/plans";
import { redirectWith } from "@/lib/redirect";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Temporary password must be at least 8 characters"),
});

export async function addStaff(fd: FormData) {
  const { tenant } = await requireOwner();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith("/dashboard/staff", { error: parsed.error.issues[0].message });

  const max = PLANS[tenant.subscription_plan].maxStaff;
  if (max !== null) {
    const { count } = await createClient().from("users").select("id", { count: "exact", head: true }).eq("role", "staff");
    if ((count ?? 0) >= max) {
      redirectWith("/dashboard/staff", { error: `Your ${PLANS[tenant.subscription_plan].name} plan allows ${max} staff account(s). Upgrade to Pro for more.` });
    }
  }

  // app_metadata can only be set with the service role — the DB trigger
  // reads it to attach the new user to THIS tenant as staff.
  const { error } = await createAdminClient().auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id, role: "staff" },
    user_metadata: { name: parsed.data.name },
  });
  if (error) redirectWith("/dashboard/staff", { error: error.message });
  revalidatePath("/dashboard/staff");
  redirectWith("/dashboard/staff", { ok: `Staff account created. Share the email and temporary password with ${parsed.data.name}.` });
}

export async function removeStaff(userId: string) {
  const { tenant, user } = await requireOwner();
  if (userId === user.id) redirectWith("/dashboard/staff", { error: "You can't remove yourself." });
  const admin = createAdminClient();
  // Verify the target really is staff of the caller's tenant before deleting.
  const { data: target } = await admin.from("users").select("id, tenant_id, role").eq("id", userId).maybeSingle();
  if (!target || target.tenant_id !== tenant.id || target.role !== "staff") {
    redirectWith("/dashboard/staff", { error: "Staff member not found." });
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) redirectWith("/dashboard/staff", { error: error.message });
  revalidatePath("/dashboard/staff");
  redirectWith("/dashboard/staff", { ok: "Staff member removed." });
}
