import { z } from "zod";
import { apiError, authenticateApi } from "@/lib/api-keys";
import { addDaysISO, todayISO } from "@/lib/dates";
import { normalizeBdPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const FIELDS = "id, customer_id, branch_id, product_name, category, serial_number, purchase_date, warranty_months, warranty_expiry_date, amc_start_date, amc_months, amc_expiry_date, is_active, notes, created_at, customers(id, name, phone, email)";

/**
 * GET /api/v1/products?expiring_within=30&page=1&per_page=100
 */
export async function GET(req: Request) {
  const ctx = await authenticateApi(req);
  if (ctx instanceof Response) return ctx;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPage = Math.min(500, Math.max(1, Number(url.searchParams.get("per_page")) || 100));
  let q = ctx.db.from("products").select(FIELDS, { count: "exact" }).eq("tenant_id", ctx.tenant.id).order("created_at");
  const within = url.searchParams.get("expiring_within");
  if (within) {
    const n = Number(within);
    if (!Number.isInteger(n) || n < 0 || n > 3650) return apiError(400, "expiring_within must be 0–3650 days");
    const from = todayISO(), to = addDaysISO(from, n);
    q = q.or(`and(warranty_expiry_date.gte.${from},warranty_expiry_date.lte.${to}),and(amc_expiry_date.gte.${from},amc_expiry_date.lte.${to})`);
  }
  const { data, count, error } = await q.range((page - 1) * perPage, page * perPage - 1);
  if (error) return apiError(500, error.message);
  return Response.json({ data, page, per_page: perPage, total: count });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const createSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    customer: z
      .object({ name: z.string().trim().min(1).max(200), phone: z.string().optional(), email: z.string().email().optional() })
      .optional(),
    product_name: z.string().trim().min(1).max(200),
    category: z.string().max(100).optional(),
    serial_number: z.string().max(100).optional(),
    purchase_date: date,
    warranty_months: z.number().int().min(0).max(600).default(0),
    amc_start_date: date.optional(),
    amc_months: z.number().int().min(1).max(600).optional(),
    branch_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => d.customer_id || d.customer, "customer_id or customer is required")
  .refine((d) => !!d.amc_start_date === !!d.amc_months, "amc_start_date and amc_months go together")
  .refine((d) => d.warranty_months > 0 || d.amc_months, "warranty_months or amc_months is required");

/** POST /api/v1/products — create a product (and its customer, matched by phone). */
export async function POST(req: Request) {
  const ctx = await authenticateApi(req);
  if (ctx instanceof Response) return ctx;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return apiError(422, "Validation failed", parsed.error.issues);
  const d = parsed.data;
  const tenantId = ctx.tenant.id;

  let customerId = d.customer_id;
  if (customerId) {
    const { data: c } = await ctx.db.from("customers").select("id").eq("id", customerId).eq("tenant_id", tenantId).maybeSingle();
    if (!c) return apiError(404, "customer_id not found");
  } else {
    const phone = d.customer!.phone ? normalizeBdPhone(d.customer!.phone) : null;
    if (d.customer!.phone && !phone) return apiError(422, "Invalid Bangladeshi mobile number");
    if (phone) {
      const { data: c } = await ctx.db.from("customers").select("id").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();
      customerId = c?.id;
    }
    if (!customerId) {
      const { data: c, error } = await ctx.db
        .from("customers")
        .insert({ tenant_id: tenantId, name: d.customer!.name, phone, email: d.customer!.email ?? null })
        .select("id")
        .single();
      if (error) return apiError(400, error.message);
      customerId = c.id;
    }
  }
  const { data, error } = await ctx.db
    .from("products")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      product_name: d.product_name,
      category: d.category ?? null,
      serial_number: d.serial_number ?? null,
      purchase_date: d.purchase_date,
      warranty_months: d.warranty_months,
      amc_start_date: d.amc_start_date ?? null,
      amc_months: d.amc_months ?? null,
      branch_id: d.branch_id ?? null,
      notes: d.notes ?? null,
    })
    .select(FIELDS)
    .single();
  if (error) return apiError(error.message.includes("Plan limit") ? 402 : 400, error.message);
  return Response.json({ data }, { status: 201 });
}
