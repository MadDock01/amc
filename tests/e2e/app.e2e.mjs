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
await ap.getByText("Trial extended by 10 days").waitFor();
await ap.fill("input[name=credits]", "250");
await ap.getByRole("button", { name: "Add", exact: true }).click();
await ap.getByText("Added 250 SMS credits").waitFor();
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

await browser.close();
console.log("E2E OK");
