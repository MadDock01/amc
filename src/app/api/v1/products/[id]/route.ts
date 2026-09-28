import { apiError, authenticateApi } from "@/lib/api-keys";

export const dynamic = "force-dynamic";

/** GET /api/v1/products/:id — product with customer and reminder history. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await authenticateApi(req);
  if (ctx instanceof Response) return ctx;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return apiError(404, "Not found");
  const { data, error } = await ctx.db
    .from("products")
    .select("*, customers(id, name, phone, email), reminders(id, reminder_type, channel, days_before, status, sent_at, expiry_date)")
    .eq("id", params.id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) return apiError(500, error.message);
  if (!data) return apiError(404, "Not found");
  const { public_token: _omit, ...rest } = data as Record<string, unknown>;
  return Response.json({ data: rest });
}
