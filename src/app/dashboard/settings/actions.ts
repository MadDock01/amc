"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeBdPhone } from "@/lib/phone";
import { friendlyDbError, redirectWith } from "@/lib/redirect";
import { REMINDER_DAY_OPTIONS } from "@/lib/plans";

const schema = z.object({
  business_name: z.string().trim().min(2).max(200),
  business_type: z.string().trim().max(100).optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().max(500).optional(),
  sms_language: z.enum(["en", "bn"]),
});


export async function saveSettings(fd: FormData) {
  const { tenant } = await requireOwner();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirectWith("/dashboard/settings", { error: parsed.error.issues[0].message });
  const d = parsed.data;
  const phone = d.phone ? normalizeBdPhone(d.phone) : null;
  if (d.phone && !phone) redirectWith("/dashboard/settings", { error: "Enter a valid Bangladeshi mobile number" });
  const days = fd
    .getAll("reminder_days")
    .map(Number)
    .filter((n) => REMINDER_DAY_OPTIONS.includes(n))
    .sort((a, b) => b - a);
  if (!days.length) redirectWith("/dashboard/settings", { error: "Pick at least one reminder day" });

  const { error } = await createClient()
    .from("tenants")
    .update({
      business_name: d.business_name,
      business_type: d.business_type || null,
      phone,
      address: d.address || null,
      sms_language: d.sms_language,
      reminder_days: days,
      notify_owner_sms: fd.get("notify_owner_sms") === "on",
      notify_owner_email: fd.get("notify_owner_email") === "on",
    })
    .eq("id", tenant.id);
  if (error) redirectWith("/dashboard/settings", { error: friendlyDbError(error) });
  revalidatePath("/dashboard", "layout");
  redirectWith("/dashboard/settings", { ok: "Settings saved." });
}
