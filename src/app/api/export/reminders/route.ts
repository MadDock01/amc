import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse, monthRange } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const month = monthRange(req.nextUrl.searchParams.get("month"));
  let q = supabase
    .from("notification_logs")
    .select("sent_at, channel, recipient_phone, recipient_email, status, sms_segments, message_content")
    .order("sent_at", { ascending: false })
    .limit(10000);
  if (month) q = q.gte("sent_at", `${month.from}T00:00:00+06:00`).lte("sent_at", `${month.to}T23:59:59+06:00`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return csvResponse(
    "reminder-log.csv",
    ["sent_at", "channel", "recipient", "status", "sms_parts", "message"],
    (data ?? []).map((l) => [l.sent_at, l.channel, l.recipient_phone ?? l.recipient_email, l.status, l.sms_segments, l.message_content]),
  );
}
