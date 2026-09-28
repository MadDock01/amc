"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner, requireTenantUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { findOrCreateCustomer } from "@/lib/customers";
import { friendlyDbError, redirectWith } from "@/lib/redirect";
import { todayISO } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendManualReminder } from "@/lib/reminders/manual";
import type { Channel, Product, ReminderType } from "@/lib/types";

const optionalInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(600).nullable());
const optionalDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());
const optionalText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(max).nullable());

const productSchema = z
  .object({
    customer_id: optionalText(64),
    new_customer_name: optionalText(200),
    new_customer_phone: optionalText(30),
    new_customer_email: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().email("Invalid customer email").nullable()),
    product_name: z.string().trim().min(1, "Product name is required").max(200),
    category: optionalText(100),
    serial_number: optionalText(100),
    purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Purchase date is required"),
    warranty_months: z.coerce.number().int().min(0).max(600),
    amc_start_date: optionalDate,
    amc_months: optionalInt,
    notes: optionalText(2000),
    branch_id: optionalText(64),
  })
  .refine((d) => d.customer_id || d.new_customer_name, { message: "Select or create a customer" })
  .refine((d) => (d.amc_start_date === null) === (d.amc_months === null), {
    message: "AMC needs both a start date and a duration (or neither)",
  })
  .refine((d) => d.warranty_months > 0 || d.amc_months, { message: "Enter a warranty or an AMC duration" });

function parse(formData: FormData) {
  return productSchema.safeParse(Object.fromEntries(formData));
}

export async function createProduct(formData: FormData) {
  await requireTenantUser();
  const parsed = parse(formData);
  if (!parsed.success) redirectWith("/dashboard/products/new", { error: parsed.error.issues[0].message });
  const d = parsed.data;
  const supabase = createClient();

  let customerId = d.customer_id;
  if (!customerId) {
    const c = await findOrCreateCustomer(supabase, { name: d.new_customer_name!, phone: d.new_customer_phone, email: d.new_customer_email });
    if (c.error || !c.id) redirectWith("/dashboard/products/new", { error: c.error ?? "Could not create customer" });
    customerId = c.id!;
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      customer_id: customerId,
      product_name: d.product_name,
      category: d.category,
      serial_number: d.serial_number,
      purchase_date: d.purchase_date,
      warranty_months: d.warranty_months,
      amc_start_date: d.amc_start_date,
      amc_months: d.amc_months,
      notes: d.notes,
      ...(formData.has("branch_id") && d.branch_id ? { branch_id: d.branch_id } : {}),
    })
    .select("id")
    .single();
  if (error) redirectWith("/dashboard/products/new", { error: friendlyDbError(error) });

  revalidatePath("/dashboard", "layout");
  if (formData.get("_another")) redirectWith("/dashboard/products/new", { ok: `Saved "${d.product_name}". Add the next one.` });
  redirectWith(`/dashboard/products/${data!.id}`, { ok: "Product saved. Expiry dates were calculated automatically." });
}

export async function updateProduct(id: string, formData: FormData) {
  await requireTenantUser();
  const parsed = parse(formData);
  const back = `/dashboard/products/${id}`;
  if (!parsed.success) redirectWith(back, { error: parsed.error.issues[0].message });
  const d = parsed.data;
  const supabase = createClient();

  let customerId = d.customer_id;
  if (!customerId) {
    const c = await findOrCreateCustomer(supabase, { name: d.new_customer_name!, phone: d.new_customer_phone, email: d.new_customer_email });
    if (c.error || !c.id) redirectWith(back, { error: c.error ?? "Could not create customer" });
    customerId = c.id!;
  }

  const { error, count } = await supabase
    .from("products")
    .update(
      {
        customer_id: customerId,
        product_name: d.product_name,
        category: d.category,
        serial_number: d.serial_number,
        purchase_date: d.purchase_date,
        warranty_months: d.warranty_months,
        amc_start_date: d.amc_start_date,
        amc_months: d.amc_months,
        notes: d.notes,
        is_active: formData.getAll("is_active").includes("true"),
        ...(formData.has("branch_id") ? { branch_id: d.branch_id } : {}),
      },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) redirectWith(back, { error: friendlyDbError(error) });
  if (!count) redirectWith("/dashboard/products", { error: "Product not found" });
  revalidatePath("/dashboard", "layout");
  redirectWith(back, { ok: "Saved." });
}

/** Renew AMC: new period starts the day the old one ends (or today if none). */
export async function renewAmc(id: string, formData: FormData) {
  await requireTenantUser();
  const months = z.coerce.number().int().min(1).max(600).safeParse(formData.get("months"));
  const back = `/dashboard/products/${id}`;
  if (!months.success) redirectWith(back, { error: "Enter the AMC duration in months" });
  const supabase = createClient();
  const { data: p } = await supabase.from("products").select("amc_expiry_date, warranty_expiry_date").eq("id", id).single();
  if (!p) redirectWith("/dashboard/products", { error: "Product not found" });
  const picked = String(formData.get("start") ?? "");
  if (picked && !/^\d{4}-\d{2}-\d{2}$/.test(picked)) redirectWith(back, { error: "Invalid start date" });
  const start = picked || p!.amc_expiry_date || p!.warranty_expiry_date || todayISO();
  const { error } = await supabase.from("products").update({ amc_start_date: start, amc_months: months.data, is_active: true }).eq("id", id);
  if (error) redirectWith(back, { error: friendlyDbError(error) });
  await supabase.from("product_followups").insert({ product_id: id, outcome: "renewed", note: `AMC renewed for ${months.data} month(s) from ${start}` });
  revalidatePath("/dashboard", "layout");
  redirectWith(back, { ok: "AMC renewed. New reminders will be scheduled automatically." });
}

export async function deleteProduct(id: string) {
  await requireOwner();
  const supabase = createClient();
  const { error, count } = await supabase.from("products").delete({ count: "exact" }).eq("id", id);
  if (error) redirectWith(`/dashboard/products/${id}`, { error: friendlyDbError(error) });
  if (!count) redirectWith(`/dashboard/products/${id}`, { error: "Only the shop owner can delete products." });
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/products?ok=Product+deleted");
}

const followupSchema = z.object({
  outcome: z.enum(["note", "contacted", "no_answer", "interested", "renewed", "lost"]),
  note: optionalText(2000),
  next_follow_up: optionalDate,
});

export async function addFollowup(id: string, formData: FormData) {
  await requireTenantUser();
  const back = `/dashboard/products/${id}`;
  const parsed = followupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirectWith(back, { error: "Pick an outcome" });
  const { error } = await createClient().from("product_followups").insert({ product_id: id, ...parsed.data });
  if (error) redirectWith(back, { error: friendlyDbError(error) });
  revalidatePath("/dashboard", "layout");
  redirectWith(back, { ok: "Follow-up saved." });
}

/** "Send reminder now": SMS/email/WhatsApp to the customer immediately (uses credits). */
export async function sendNow(id: string, formData: FormData) {
  const { tenant, user } = await requireTenantUser();
  const back = `/dashboard/products/${id}`;
  const type = z.enum(["warranty", "amc"]).safeParse(formData.get("type"));
  const channels = formData.getAll("channel").filter((c): c is Channel => c === "sms" || c === "email" || c === "whatsapp");
  if (!type.success) redirectWith(back, { error: "Pick warranty or AMC" });
  // Visibility check through RLS before using the service role.
  const { data: product } = await createClient().from("products").select("*").eq("id", id).maybeSingle();
  if (!product) redirectWith("/dashboard/products", { error: "Product not found" });
  const res = await sendManualReminder(createAdminClient(), {
    product: product as Product,
    tenant,
    type: type.data as ReminderType,
    channels,
    userId: user.id,
  });
  if ("error" in res && res.error) redirectWith(back, { error: res.error });
  const s = res.summary!;
  revalidatePath(back);
  if (s.sent) redirectWith(back, { ok: `Reminder sent (${s.sent} channel(s)).` });
  redirectWith(back, { error: `Not sent: ${s.deferred ? "daily SMS limit reached, will go out tomorrow" : "see reminder history for the reason"}.` });
}
