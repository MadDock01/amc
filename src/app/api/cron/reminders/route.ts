import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyJob } from "@/lib/reminders/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * GET /api/cron/reminders            → full daily job (generate + send)
 * GET /api/cron/reminders?mode=send  → only drain the queue (retries), run hourly
 *
 * Call with header `Authorization: Bearer $CRON_SECRET` (Vercel Cron does this
 * automatically; on a VPS use crontab + curl).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const mode = req.nextUrl.searchParams.get("mode");
  const result = await runDailyJob(createAdminClient(), { generate: mode !== "send" });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
