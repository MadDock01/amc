// End-to-end test through the browser against a running app + Supabase.
// Needs a fresh database, SMS_PROVIDER=console and the same CRON_SECRET as the app.
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… BASE_URL=http://localhost:3000 CRON_SECRET=… npm run test:e2e
// Optional: SHOTS=/some/dir to save screenshots, CHROMIUM_PATH to use a system Chromium.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const env = (k, d) => process.env[k] ?? d;
const admin = createClient(env("SUPABASE_URL", "http://127.0.0.1:54321"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const BASE = env("BASE_URL", "http://127.0.0.1:3000");
const CRON = `Bearer ${env("CRON_SECRET", "test-cron-secret")}`;
const SHOTS = process.env.SHOTS;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const expiry = addDays(today, 10);
const purchase = `${Number(expiry.slice(0, 4)) - 1}${expiry.slice(4)}`;
const run = Date.now();
const ownerEmail = `owner${run}@shop.test`, staffEmail = `staff${run}@shop.test`, adminEmail = `root${run}@platform.test`;
const step = (m) => console.log("✔", m);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

// 1. Signup → tenant + trial
await page.goto(BASE + "/signup");
await page.fill("#business_name", "Rahman Electronics");
await page.fill("#name", "Rahman");
await page.fill("#phone", "01711000111");
await page.fill("#email", ownerEmail);
await page.fill("#password", "password123");
await page.click("button[type=submit]");
await page.waitForURL(/\/dashboard/);
assert.match(await page.textContent("body"), /14-day free trial has started/);
assert.match(await page.textContent("body"), /Free trial: 1[34] day/);
step("signup created tenant and trial");
await shot("01-dashboard-empty");

// 2. Add product with a new customer, warranty expiring in 10 days
await page.goto(BASE + "/dashboard/products/new");
await page.getByPlaceholder("Search customer by name or mobile…").click();
await page.getByText("+ Create new customer").click();
await page.fill("input[name=new_customer_name]", "Abdul Karim");
await page.fill("input[name=new_customer_phone]", "01811222333");
await page.fill("input[name=new_customer_email]", "karim@example.com");
await page.fill("#product_name", "Walton AC 1.5 ton");
await page.fill("#purchase_date", purchase);
await page.fill("#warranty_months", "12");
await page.fill("#amc_months", "12");
await page.getByRole("button", { name: "After warranty" }).click();
await shot("02-product-form");
await page.getByRole("button", { name: "Save product" }).click();
await page.waitForURL(/\/dashboard\/products\/[0-9a-f-]{36}/);
assert.match(await page.textContent("body"), /Expiry dates were calculated automatically/);
step("product created via form with new customer");

// 3. Overview lists it as expiring this week? (10 days → later this month)
await page.goto(BASE + "/dashboard");
assert.match(await page.textContent("body"), /Walton AC 1.5 ton/);
step("overview shows expiring product");

// 4. CSV import (reuses customer by phone, one bad row)
const csvPath = join(tmpdir(), `amc-import-${Date.now()}.csv`);
writeFileSync(csvPath,
  "Customer Name,Mobile No,Product,Serial No,Purchase Date,Warranty,AMC\n" +
  `Abdul Karim,01811-222333,Samsung TV,SN1,${addDays(today, -360).split("-").reverse().join("/")},1 year,\n` +
  `Rahima Begum,01911444555,Solar panel,SN2,15/01/2026,24,12\n` +
  `Bad Row,,,,,,\n`);
await page.goto(BASE + "/dashboard/products/import");
await page.setInputFiles("input[type=file]", csvPath);
await page.getByText(/2 valid/).waitFor();
await shot("03-import-preview");
await page.getByRole("button", { name: /Import 2 products/ }).click();
await page.getByText("2 imported").waitFor({ timeout: 20000 });
step("CSV import: 2 imported, 1 invalid skipped");

// 5. Products list + filter
await page.goto(BASE + "/dashboard/products?filter=30");
const listText = await page.textContent("body");
assert.match(listText, /Walton AC/);
assert.match(listText, /Samsung TV/);
assert.doesNotMatch(listText, /Solar panel/);
await shot("04-products-30d");
const { count: custCount } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("name", "Abdul Karim");
assert.equal(custCount, 1, "customer deduplicated by phone");
step("list filter + customer dedupe by phone");

// 6. Run the cron job
let res = await fetch(BASE + "/api/cron/reminders");
assert.equal(res.status, 401);
res = await fetch(BASE + "/api/cron/reminders", { headers: { authorization: CRON } });
const body = await res.json();
console.log("   cron:", JSON.stringify(body.details));
assert.equal(res.status, 200);
assert.ok(body.details.generated >= 3, "sms+email for 2 products");
assert.ok(body.details.queue.sent >= 3);
const { data: logs } = await admin.from("notification_logs").select("*").eq("kind", "reminder");
assert.ok(logs.some((l) => l.recipient_phone === "8801811222333" && l.status === "sent" && /\/w\//.test(l.message_content)));
assert.ok(logs.some((l) => l.recipient_email === ownerEmail));
res = await fetch(BASE + "/api/cron/reminders", { headers: { authorization: CRON } });
assert.equal((await res.json()).details.generated, 0, "second run is idempotent");
step("cron generated + sent reminders; rerun idempotent");

await page.goto(BASE + "/dashboard/reminders");
assert.match(await page.textContent("body"), /sent/);
await shot("05-reminders");
await page.goto(BASE + "/dashboard/reminders?tab=log");
await shot("06-delivery-log");

// 7. Public warranty page
const { data: prod } = await admin.from("products").select("public_token").eq("product_name", "Walton AC 1.5 ton").single();
await page.goto(`${BASE}/w/${prod.public_token}`);
assert.match(await page.textContent("body"), /Warranty until/);
assert.doesNotMatch(await page.textContent("body"), /01811/);
await shot("07-public-page");
step("public warranty page");

// 8. Reports + CSV export
await page.goto(BASE + "/dashboard/reports");
await shot("08-reports");
const csv = await page.evaluate(async () => (await fetch("/api/export/products")).text());
assert.match(csv, /Walton AC 1.5 ton/);
step("reports + CSV export");

// 9. Staff
await page.goto(BASE + "/dashboard/staff");
await page.fill("input[name=name]", "Sumon");
await page.fill("input[name=email]", staffEmail);
await page.fill("input[name=password]", "staffpass1");
await page.getByRole("button", { name: "Add staff" }).click();
await page.getByText("Staff account created").waitFor();
step("owner created staff");

const ctx2 = await browser.newContext();
const sp = await ctx2.newPage();
await sp.goto(BASE + "/login");
await sp.fill("#email", staffEmail);
await sp.fill("#password", "staffpass1");
await sp.click("button[type=submit]");
await sp.waitForURL(/\/dashboard/);
assert.doesNotMatch(await sp.textContent("nav"), /Billing/);
await sp.goto(BASE + "/dashboard/billing");
assert.match(sp.url(), /owner-only/);
await sp.goto(BASE + "/dashboard/products");
assert.match(await sp.textContent("body"), /Walton AC/);
await sp.getByText("Walton AC 1.5 ton").first().click();
await sp.waitForURL(/products\/[0-9a-f-]{36}/);
assert.doesNotMatch(await sp.textContent("body"), /Delete product/);
step("staff can see products, no billing/delete");

// 10. Another tenant sees nothing of this one
const other = await browser.newContext();
const op = await other.newPage();
await op.goto(BASE + "/signup");
await op.fill("#business_name", "Other Shop");
await op.fill("#name", "Other");
await op.fill("#phone", "01611000999");
await op.fill("#email", `other${run}@shop.test`);
await op.fill("#password", "password123");
await op.click("button[type=submit]");
await op.waitForURL(/\/dashboard/);
await op.goto(BASE + "/dashboard/products");
assert.doesNotMatch(await op.textContent("body"), /Walton/);
const { data: someProd } = await admin.from("products").select("id").eq("product_name", "Walton AC 1.5 ton").single();
await op.goto(`${BASE}/dashboard/products/${someProd.id}`);
assert.match(await op.textContent("body"), /404|could not be found/i);
step("tenant isolation through the app");

// 11. Super admin
const { error: saErr } = await admin.auth.admin.createUser({ email: adminEmail, password: "rootpass123", email_confirm: true, app_metadata: { role: "super_admin" } });
assert.equal(saErr, null);
const ctx3 = await browser.newContext();
const ap = await ctx3.newPage();
ap.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await ap.goto(BASE + "/login");
await ap.fill("#email", adminEmail);
await ap.fill("#password", "rootpass123");
await ap.click("button[type=submit]");
await ap.waitForURL(/\/super-admin/);
assert.match(await ap.textContent("body"), /MRR/);
if (SHOTS) await ap.screenshot({ path: `${SHOTS}/09-super-admin.png`, fullPage: true });
await ap.goto(BASE + "/super-admin/tenants");
await ap.getByText("Rahman Electronics").click();
await ap.waitForURL(/tenants\/[0-9a-f-]{36}/);
await ap.fill("input[name=days]", "10");
await ap.getByRole("button", { name: "Extend" }).click();
await ap.getByText("Trial extended by 10 days.", { exact: true }).waitFor();
await ap.fill("input[name=credits]", "250");
await ap.getByRole("button", { name: "Add", exact: true }).click();
await ap.getByText("Added 250 SMS credits.", { exact: true }).waitFor();
if (SHOTS) await ap.screenshot({ path: `${SHOTS}/10-tenant-detail.png`, fullPage: true });
await ap.goto(BASE + "/super-admin/health");
assert.match(await ap.textContent("body"), /daily-reminders/);
if (SHOTS) await ap.screenshot({ path: `${SHOTS}/11-health.png`, fullPage: true });
await ap.goto(BASE + "/super-admin/tenants/new");
await ap.fill("input[name=business_name]", "Solar House");
await ap.fill("input[name=owner_name]", "Mitu");
await ap.fill("input[name=email]", `solar${run}@shop.test`);
await ap.fill("input[name=password]", "solarpass1");
await ap.fill("input[name=trial_days]", "30");
await ap.getByRole("button", { name: "Create tenant" }).click();
await ap.getByText("Tenant created").waitFor();
step("super admin: overview, extend trial, credits, health, onboard tenant");

// owner cannot reach super admin
await page.goto(BASE + "/super-admin");
assert.match(page.url(), /\/dashboard/);
step("owner blocked from /super-admin");


// ---------------------------------------------------------------------------
// Full feature set
// ---------------------------------------------------------------------------
const walton = (await admin.from("products").select("id, public_token, tenant_id").eq("product_name", "Walton AC 1.5 ton").single()).data;
const tenantId = walton.tenant_id;

// 12. Account page + forgot password page
await page.goto(BASE + "/account");
await page.fill("input[name=name]", "Rahman Hossain");
await page.getByRole("button", { name: "Save profile" }).click();
await page.getByText("Profile saved.").waitFor();
await page.goto(BASE + "/forgot-password");
assert.match(await page.textContent("body"), /Reset your password/);
step("account profile + forgot password page");

// 13. Custom SMS template with live preview
await page.goto(BASE + "/dashboard/settings");
await page.fill("#sms_template", "Hi {customer}! {product} {type} ends {when}. Call {shop} {phone}");
assert.match(await page.textContent("body"), /Hi Abdul Karim! Walton AC 1\.5 ton warranty ends/);
await page.getByRole("button", { name: "Save settings" }).click();
await page.getByText("Settings saved.").waitFor();
step("custom SMS template saved with preview");

// 14. Follow-up + send now (uses template)
await page.goto(`${BASE}/dashboard/products/${walton.id}`);
await page.selectOption("select[name=outcome]", "interested");
await page.fill("input[name=note]", "Wants 2-year AMC");
await page.getByRole("button", { name: "Log follow-up" }).click();
await page.getByText("Follow-up saved.").waitFor();
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Send now" }).click();
await page.getByText(/Reminder sent/).waitFor();
const { data: manualLog } = await admin.from("notification_logs").select("message_content").eq("tenant_id", tenantId).eq("channel", "sms").order("sent_at", { ascending: false }).limit(1).single();
assert.match(manualLog.message_content, /^Hi Abdul Karim! Walton AC 1\.5 ton warranty ends/);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/12-product-crm.png`, fullPage: true });
step("follow-up logged; manual send used the custom template");

// 15. Customer requests a renewal call from the public page
const pub = await (await browser.newContext()).newPage();
const shortTok = Buffer.from(walton.public_token.replace(/-/g, ""), "hex").toString("base64url");
await pub.goto(`${BASE}/w/${shortTok}`);
await pub.fill("input[name=callback_phone]", "01811222333");
await pub.fill("textarea[name=message]", "Please call after 5pm");
await pub.getByRole("button", { name: "Request a renewal call" }).click();
await pub.getByText(/shop has been notified/).waitFor();
await pub.reload();
await pub.getByRole("button", { name: "Request a renewal call" }).click();
await pub.getByText(/already have your request/).waitFor();
await page.goto(BASE + "/dashboard");
assert.match(await page.textContent("nav"), /Requests \(1\)/);
await page.goto(BASE + "/dashboard/requests");
assert.match(await page.textContent("body"), /Please call after 5pm/);
await page.getByRole("button", { name: "Mark handled" }).click();
await page.getByText("Marked as handled.").waitFor();
step("public renewal request → inbox → handled (with 24h de-dup)");

// 16. Platform admin: upgrade to Enterprise + manual SMS-pack payment
await ap.goto(`${BASE}/super-admin/tenants/${tenantId}`);
await ap.selectOption("select[name=plan] >> nth=0", "enterprise");
await ap.fill("input[name=ends_at]", "2027-12-31");
await ap.getByRole("button", { name: "Update plan" }).click();
await ap.getByText("Plan updated.").waitFor();
const before = (await admin.from("sms_credits").select("balance").eq("tenant_id", tenantId).single()).data.balance;
await ap.selectOption("select[name=kind]", "sms_pack");
await ap.fill("input[name=sms_pack_size]", "500");
await ap.fill("input[name=amount]", "250");
await ap.fill("input[name=reference]", "CASH-001");
ap.once("dialog", (d) => d.accept());
await ap.getByRole("button", { name: "Record", exact: true }).click();
await ap.getByText("Payment recorded and activated.").waitFor();
const after = (await admin.from("sms_credits").select("balance").eq("tenant_id", tenantId).single()).data.balance;
assert.equal(after - before, 500);
assert.match(await ap.textContent("body"), /admin\.manual_payment/);
await ap.goto(BASE + "/super-admin/payments");
assert.match(await ap.textContent("body"), /Rahman Electronics/);
if (SHOTS) await ap.screenshot({ path: `${SHOTS}/13-admin-payments.png`, fullPage: true });
step("super admin: enterprise upgrade, manual payment, audit, payments page");

// 17. Owner sees invoice, yearly pricing, SMS packs
await page.goto(BASE + "/dashboard/billing?cycle=yearly");
assert.match(await page.textContent("body"), /৳5,000/);
assert.match(await page.textContent("body"), /500 SMS/);
await page.getByRole("link", { name: "Invoice" }).first().click();
await page.getByText(/INV-\d{6}/).waitFor();
step("billing: yearly prices, SMS packs, invoice");

// 18. Branches + branch-scoped staff
await page.goto(BASE + "/dashboard/branches");
await page.fill("input[name=name]", "Mirpur");
await page.getByRole("button", { name: "Add branch" }).click();
await page.getByText("Branch added.").waitFor();
await page.goto(BASE + "/dashboard/staff");
await page.locator("tr", { hasText: staffEmail }).locator("select[name=branch_id]").selectOption({ label: "Mirpur" });
await page.locator("tr", { hasText: staffEmail }).getByRole("button", { name: "Set" }).click();
await page.getByText("Branch updated.").waitFor();
await sp.goto(BASE + "/dashboard/products");
assert.doesNotMatch(await sp.textContent("body"), /Walton/, "branch staff don't see unassigned products");
step("branches: staff scoped to Mirpur no longer see other products");

// 19. API key → REST API
await page.goto(BASE + "/dashboard/api");
await page.fill("input[name=name]", "POS");
await page.getByRole("button", { name: "Create key" }).click();
const apiKey = (await page.getByTestId("new-api-key").textContent()).trim();
const api = (path, init = {}) => fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(init.headers ?? {}) } });
let r = await api("/api/v1/products", { method: "POST", body: JSON.stringify({ customer: { name: "API Customer", phone: "01555000111" }, product_name: "IPS 1000VA", purchase_date: today, warranty_months: 12 }) });
assert.equal(r.status, 201, await r.clone().text());
const created = (await r.json()).data;
assert.equal(created.warranty_expiry_date.slice(0, 4), String(Number(today.slice(0, 4)) + 1));
r = await api("/api/v1/products?expiring_within=30");
assert.equal(r.status, 200);
assert.ok((await r.json()).total >= 2);
r = await api(`/api/v1/products/${created.id}`);
assert.equal((await r.json()).data.product_name, "IPS 1000VA");
r = await api("/api/v1/customers?phone=01555000111");
assert.equal((await r.json()).data.length, 1);
r = await fetch(BASE + "/api/v1/products", { headers: { authorization: "Bearer amc_wrong" } });
assert.equal(r.status, 401);
// other tenant's product is invisible
const otherProd = (await admin.from("products").select("id").neq("tenant_id", tenantId).limit(1).maybeSingle()).data;
if (otherProd) assert.equal((await api(`/api/v1/products/${otherProd.id}`)).status, 404);
await page.goto(BASE + "/dashboard/activity");
assert.match(await page.textContent("body"), /API: POS/);
step("API key: create product, list, get, lookup customer, 401/404, activity shows API actor");

await page.getByRole("link", { name: "API" }).click();
page.once("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Revoke" }).click();
await page.getByText("Key revoked.").waitFor();
assert.equal((await api("/api/v1/products")).status, 401);
step("revoked key is rejected");

// 20. Reports show renewal performance
await page.goto(BASE + "/dashboard/reports");
assert.match(await page.textContent("body"), /Renewal performance/);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/14-reports.png`, fullPage: true });
step("reports: renewal performance");

await browser.close();
console.log("E2E OK");
