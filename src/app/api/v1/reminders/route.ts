import { apiError, authenticateApi } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

/** GET /api/v1/reminders?status=sent|failed|pending&since=ISO&page=&per_page= */
export async function GET(req: Request) {
  const ctx = await authenticateApi(req);
  if (ctx instanceof Response) return ctx;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(500, Math.max(1, Number(url.searchParams.get("per_page")) || 100));
  let q = ctx.db
    .from("reminders")
    .select("id, product_id, reminder_type, channel, days_before, expiry_date, status, attempts, last_error, sent_at, created_at, is_manual", { count: "exact" })
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false });
  const status = url.searchParams.get("status");
  if (status) {
    if (!["pending", "sent", "failed", "cancelled"].includes(status)) return apiError(400, "Invalid status");
    q = q.eq("status", status);
  }
  const since = url.searchParams.get("since");
  if (since) {
    if (Number.isNaN(Date.parse(since))) return apiError(400, "Invalid since");
    q = q.gte("created_at", new Date(since).toISOString());
  }
  const { data, count, error } = await q.range((page - 1) * perPage, page * perPage - 1);
  if (error) return apiError(500, error.message);
  return Response.json({ data, page, per_page: perPage, total: count });
}
