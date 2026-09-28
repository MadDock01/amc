import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysBetween, todayISO } from "../dates";
import type { Channel, Product, ReminderType, Tenant } from "../types";
import { processReminderQueue } from "./engine";

/**
 * "Send reminder now" from the product page. The caller must already have
 * verified (via the RLS client) that the user can see this product.
 */
export async function sendManualReminder(
  admin: SupabaseClient,
  opts: { product: Product; tenant: Tenant; type: ReminderType; channels: Channel[]; userId: string },
) {
  const expiry = opts.type === "amc" ? opts.product.amc_expiry_date : opts.product.warranty_expiry_date;
  if (!expiry) return { error: `This product has no ${opts.type === "amc" ? "AMC" : "warranty"} date.` };
  const channels = opts.channels.filter((c) => c !== "whatsapp" || opts.tenant.whatsapp_enabled);
  if (!channels.length) return { error: "Pick at least one channel." };

  const { data, error } = await admin
    .from("reminders")
    .insert(
      channels.map((channel) => ({
        tenant_id: opts.tenant.id,
        product_id: opts.product.id,
        reminder_type: opts.type,
        days_before: daysBetween(todayISO(), expiry),
        expiry_date: expiry,
        scheduled_date: todayISO(),
        channel,
        is_manual: true,
        created_by: opts.userId,
      })),
    )
    .select("id");
  if (error) return { error: error.message };
  const summary = await processReminderQueue(admin, { ids: (data ?? []).map((r) => r.id) });
  return { summary };
}
