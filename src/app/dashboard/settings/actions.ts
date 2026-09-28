"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeBdPhone } from "@/lib/phone";
import { friendlyDbError, redirectWith } from "@/lib/redirect";
import { hasFeature, REMINDER_DAY_OPTIONS } from "@/lib/plans";
import { validateTemplate } from "@/lib/notify/templates";

const schema = z.object({
  business_name: z.string().trim().min(2).max(200),
  business_type: z.string().trim().max(100).optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().max(500).optional(),
  sms_language: z.enum(["en", "bn"]),
  sms_template: z.string().trim().max(480).optional(),
  sms_daily_cap: z.coerce.number().int().min(1).max(1000),
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
  const template = d.sms_template || null;
  if (template) {
    const err = validateTemplate(template);
    if (err) redirectWith("/dashboard/settings", { error: err });
  }
  // A platform-set cap above 1000 is kept unless the owner lowers it.
  const cap = tenant.sms_daily_cap > 1000 && d.sms_daily_cap === 1000 ? tenant.sms_daily_cap : d.sms_daily_cap;

  const { error } = await createClient()
    .from("tenants")
    .update({
      business_name: d.business_name,
      business_type: d.business_type || null,
      phone,
      address: d.address || null,
      sms_language: d.sms_language,
      sms_template: template,
      sms_daily_cap: cap,
      reminder_days: days,
      notify_owner_sms: fd.get("notify_owner_sms") === "on",
      notify_owner_email: fd.get("notify_owner_email") === "on",
      whatsapp_enabled: hasFeature(tenant.subscription_plan, "whatsapp") && fd.get("whatsapp_enabled") === "on",
    })
    .eq("id", tenant.id);
  if (error) redirectWith("/dashboard/settings", { error: friendlyDbError(error) });
  revalidatePath("/dashboard", "layout");
  redirectWith("/dashboard/settings", { ok: "Settings saved." });
}
