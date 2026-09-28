import { z } from "zod";
import { apiError, authenticateApi } from "@/lib/api-keys";
import { normalizeBdPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** GET /api/v1/customers?phone=01…&page=&per_page= */
export async function GET(req: Request) {
  const ctx = await authenticateApi(req);
  if (ctx instanceof Response) return ctx;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(500, Math.max(1, Number(url.searchParams.get("per_page")) || 100));
  let q = ctx.db.from("customers").select("id, name, phone, email, address, created_at", { count: "exact" }).eq("tenant_id", ctx.tenant.id).order("created_at");
  const phone = url.searchParams.get("phone");
  if (phone) {
    const n = normalizeBdPhone(phone);
    if (!n) return apiError(400, "Invalid phone");
    q = q.eq("phone", n);
  }
  const { data, count, error } = await q.range((page - 1) * perPage, page * perPage - 1);
  if (error) return apiError(500, error.message);
  return Response.json({ data, page, per_page: perPage, total: count });
}

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
});

/** POST /api/v1/customers — idempotent on phone: returns the existing customer (200) or creates one (201). */
export async function POST(req: Request) {
  const ctx = await authenticateApi(req);
  if (ctx instanceof Response) return ctx;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.issues);
  const phone = parsed.data.phone ? normalizeBdPhone(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return apiError(422, "Invalid Bangladeshi mobile number");
  if (phone) {
    const { data } = await ctx.db.from("customers").select("*").eq("tenant_id", ctx.tenant.id).eq("phone", phone).maybeSingle();
    if (data) return Response.json({ data }, { status: 200 });
  }
  const { data, error } = await ctx.db
    .from("customers")
    .insert({ tenant_id: ctx.tenant.id, name: parsed.data.name, phone, email: parsed.data.email ?? null, address: parsed.data.address ?? null })
    .select("*")
    .single();
  if (error) return apiError(400, error.message);
  return Response.json({ data }, { status: 201 });
}
