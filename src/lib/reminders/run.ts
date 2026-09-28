import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "../dates";
import { processReminderQueue, sendPlatformRenewalNotices } from "./engine";

/**
 * The daily job: expire lapsed tenants → generate reminders → send queue →
 * platform renewal notices. Every run is recorded in cron_runs for the
 * super admin's system-health page.
 */
export async function runDailyJob(admin: SupabaseClient, opts: { generate?: boolean } = {}) {
  const job = opts.generate === false ? "send-reminders" : "daily-reminders";
  const { data: run } = await admin.from("cron_runs").insert({ job }).select("id").single();
  const details: Record<string, unknown> = {};
  try {
    if (opts.generate !== false) {
      const { data: expired, error: e1 } = await admin.rpc("expire_lapsed_tenants");
      if (e1) throw new Error(`expire_lapsed_tenants: ${e1.message}`);
      details.expired_tenants = expired;

      const { data: generated, error: e2 } = await admin.rpc("generate_due_reminders", { run_date: todayISO() });
      if (e2) throw new Error(`generate_due_reminders: ${e2.message}`);
      details.generated = generated;
    }

    details.queue = await processReminderQueue(admin);
    if (opts.generate !== false) details.renewal_notices = await sendPlatformRenewalNotices(admin);

    if (run) await admin.from("cron_runs").update({ status: "ok", finished_at: new Date().toISOString(), details }).eq("id", run.id);
    return { ok: true as const, details };
  } catch (e) {
    details.error = (e as Error).message;
    if (run) await admin.from("cron_runs").update({ status: "error", finished_at: new Date().toISOString(), details }).eq("id", run.id);
    return { ok: false as const, details };
  }
}
