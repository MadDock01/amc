// Runs the real migration against PGlite (Postgres in WASM) with a stubbed
// Supabase auth schema, and checks tenant isolation + reminder generation.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../", import.meta.url);
let db;

async function signUp(email, userMeta = {}, appMeta = {}) {
  const r = await db.query(
    "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id",
    [email, userMeta, appMeta],
  );
  return r.rows[0].id;
}

// Run fn as a signed-in end user (role authenticated, RLS enforced).
async function asUser(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await tx.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await tx.query("set local role authenticated");
    return fn(tx);
  });
}

const tenantOf = async (uid) =>
  (await db.query("select tenant_id from public.users where id = $1", [uid])).rows[0].tenant_id;

let ownerA, ownerB, staffA, admin, tenantA, tenantB, customerA;

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(new URL("tests/supabase-auth-stub.sql", root), "utf8"));
  const dir = new URL("supabase/migrations/", root);
  for (const f of readdirSync(dir).sort()) {
    await db.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  ownerA = await signUp("a@shop.test", { business_name: "Shop A", name: "Alice", phone: "01700000001" });
  ownerB = await signUp("b@shop.test", { business_name: "Shop B", name: "Bob" });
  tenantA = await tenantOf(ownerA);
  tenantB = await tenantOf(ownerB);
  staffA = await signUp("s@shop.test", { name: "Sam" }, { tenant_id: tenantA, role: "staff" });
  admin = await signUp("root@platform.test", {}, { role: "super_admin" });
});

test("self signup creates a trial tenant, owner user and SMS credits", async () => {
  assert.notEqual(tenantA, tenantB);
  const t = (await db.query("select * from public.tenants where id = $1", [tenantA])).rows[0];
  assert.equal(t.business_name, "Shop A");
  assert.equal(t.subscription_plan, "trial");
  assert.ok(t.trial_ends_at > new Date(Date.now() + 13 * 864e5));
  const u = (await db.query("select role from public.users where id = $1", [ownerA])).rows[0];
  assert.equal(u.role, "owner");
  const c = (await db.query("select balance from public.sms_credits where tenant_id = $1", [tenantA])).rows[0];
  assert.equal(c.balance, 10);
});

test("user metadata cannot be used to join another tenant", async () => {
  const evil = await signUp("evil@x.test", { tenant_id: tenantA, role: "staff", business_name: "Evil" });
  assert.notEqual(await tenantOf(evil), tenantA);
  const u = (await db.query("select role from public.users where id = $1", [evil])).rows[0];
  assert.equal(u.role, "owner");
});

test("staff invited via app_metadata joins the owner's tenant", async () => {
  assert.equal(await tenantOf(staffA), tenantA);
});

test("products get computed expiry dates and tenant_id default", async () => {
  await asUser(ownerA, async (tx) => {
    customerA = (
      await tx.query("insert into public.customers (name, phone) values ('Karim', '01811111111') returning id")
    ).rows[0].id;
    const p = (
      await tx.query(
        `insert into public.products (customer_id, product_name, purchase_date, warranty_months, amc_start_date, amc_months)
         values ($1, 'Samsung TV', '2026-01-31', 1, '2026-03-01', 12) returning *`,
        [customerA],
      )
    ).rows[0];
    assert.equal(p.tenant_id, tenantA);
    assert.equal(p.warranty_expiry_date.toISOString().slice(0, 10), "2026-02-28");
    assert.equal(p.amc_expiry_date.toISOString().slice(0, 10), "2027-03-01");
  });
});

test("tenant B cannot see or reference tenant A data", async () => {
  await asUser(ownerB, async (tx) => {
    assert.equal((await tx.query("select * from public.products")).rows.length, 0);
    assert.equal((await tx.query("select * from public.customers")).rows.length, 0);
    assert.equal((await tx.query("select * from public.tenants")).rows.length, 1);
    const upd = await tx.query("update public.products set product_name = 'hacked'");
    assert.equal(upd.affectedRows, 0);
  });
  // Using A's customer id from B fails the composite FK.
  await assert.rejects(
    asUser(ownerB, (tx) =>
      tx.query(
        "insert into public.products (customer_id, product_name, purchase_date, warranty_months) values ($1, 'x', '2026-01-01', 12)",
        [customerA],
      ),
    ),
  );
  // Explicitly writing A's tenant_id is rejected by RLS.
  await assert.rejects(
    asUser(ownerB, (tx) =>
      tx.query("insert into public.customers (tenant_id, name) values ($1, 'x')", [tenantA]),
    ),
  );
});

test("owners cannot change their own plan; users cannot change role", async () => {
  await assert.rejects(
    asUser(ownerA, (tx) => tx.query("update public.tenants set subscription_plan = 'enterprise'")),
    /subscription fields/,
  );
  await asUser(ownerA, (tx) => tx.query("update public.tenants set address = 'Dhaka'"));
  await assert.rejects(
    asUser(staffA, (tx) => tx.query("update public.users set role = 'owner' where id = $1", [staffA])),
    /role or tenant/,
  );
});

test("staff can add but not delete products, and cannot see billing", async () => {
  await asUser(staffA, async (tx) => {
    assert.equal((await tx.query("select * from public.products")).rows.length, 1);
    const del = await tx.query("delete from public.products");
    assert.equal(del.affectedRows, 0);
    const upd = await tx.query("update public.tenants set address = 'x'");
    assert.equal(upd.affectedRows, 0);
  });
  await db.query("insert into public.subscriptions (tenant_id, plan, amount) values ($1, 'basic', 500)", [tenantA]);
  await asUser(staffA, async (tx) => {
    assert.equal((await tx.query("select * from public.subscriptions")).rows.length, 0);
  });
  await asUser(ownerA, async (tx) => {
    assert.equal((await tx.query("select * from public.subscriptions")).rows.length, 1);
  });
});

test("end users cannot call backend-only functions", async () => {
  await assert.rejects(asUser(ownerA, (tx) => tx.query("select public.generate_due_reminders()")));
  await assert.rejects(asUser(ownerA, (tx) => tx.query("select public.add_sms_credits($1, 1000)", [tenantA])));
});

test("super admin sees all tenants", async () => {
  await asUser(admin, async (tx) => {
    assert.ok((await tx.query("select * from public.tenants")).rows.length >= 2);
    assert.equal((await tx.query("select * from public.products")).rows.length, 1);
  });
});

test("reminder generation picks the current window and is idempotent", async () => {
  const today = "2026-06-01";
  let productId;
  await asUser(ownerA, async (tx) => {
    // warranty expires 2026-06-11 → 10 days left → 15-day window
    productId = (
      await tx.query(
        "insert into public.products (customer_id, product_name, purchase_date, warranty_months) values ($1, 'Fridge', '2025-06-11', 12) returning id",
        [customerA],
      )
    ).rows[0].id;
  });
  const n1 = (await db.query("select public.generate_due_reminders($1::date) as n", [today])).rows[0].n;
  const rows = (await db.query("select * from public.reminders where product_id = $1 order by channel", [productId])).rows;
  // sms always; email because the owner gets email notifications by default
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.days_before), [15, 15]);
  assert.ok(n1 >= 2);
  const n2 = (await db.query("select public.generate_due_reminders($1::date) as n", [today])).rows[0].n;
  assert.equal(n2, 0);
  // 4 days later → 7-day window, new reminders
  await db.query("select public.generate_due_reminders('2026-06-05'::date)");
  const rows2 = (await db.query("select days_before from public.reminders where product_id = $1 and channel = 'sms' order by days_before", [productId])).rows;
  assert.deepEqual(rows2.map((r) => r.days_before), [7, 15]);
  // past expiry → nothing new
  const n3 = (await db.query("select public.generate_due_reminders('2026-06-12'::date) as n")).rows[0].n;
  assert.equal(n3, 0);
});

test("SMS credits are consumed atomically", async () => {
  assert.equal((await db.query("select public.consume_sms_credits($1, 8) as ok", [tenantA])).rows[0].ok, true);
  assert.equal((await db.query("select public.consume_sms_credits($1, 5) as ok", [tenantA])).rows[0].ok, false);
  const bal = (await db.query("select balance from public.sms_credits where tenant_id = $1", [tenantA])).rows[0].balance;
  assert.equal(bal, 2);
});

test("trial product limit and expired tenants are enforced", async () => {
  await asUser(ownerB, async (tx) => {
    const c = (await tx.query("insert into public.customers (name) values ('X') returning id")).rows[0].id;
    for (let i = 0; i < 25; i++) {
      await tx.query(
        "insert into public.products (customer_id, product_name, purchase_date, warranty_months) values ($1, $2, '2026-01-01', 12)",
        [c, `P${i}`],
      );
    }
  });
  await assert.rejects(
    asUser(ownerB, async (tx) => {
      const c = (await tx.query("select id from public.customers limit 1")).rows[0].id;
      await tx.query(
        "insert into public.products (customer_id, product_name, purchase_date, warranty_months) values ($1, 'one too many', '2026-01-01', 12)",
        [c],
      );
    }),
    /Plan limit reached/,
  );
  await db.query("update public.tenants set trial_ends_at = now() - interval '1 day' where id = $1", [tenantB]);
  const n = (await db.query("select public.expire_lapsed_tenants() as n")).rows[0].n;
  assert.ok(n >= 1);
  const t = (await db.query("select subscription_status from public.tenants where id = $1", [tenantB])).rows[0];
  assert.equal(t.subscription_status, "expired");
});

test("claiming reminders leases them so parallel runs don't double-send", async () => {
  const first = (await db.query("select * from public.claim_due_reminders(100)")).rows;
  assert.ok(first.length > 0);
  const second = (await db.query("select * from public.claim_due_reminders(100)")).rows;
  assert.equal(second.length, 0);
});

test("activating a subscription upgrades the tenant and tops up SMS", async () => {
  const sub = (
    await db.query("insert into public.subscriptions (tenant_id, plan, amount, payment_ref) values ($1, 'pro', 1200, 'PAY1') returning id", [tenantB])
  ).rows[0].id;
  const before = (await db.query("select balance from public.sms_credits where tenant_id = $1", [tenantB])).rows[0].balance;
  await db.query("select public.activate_subscription($1, 'TRX1')", [sub]);
  await db.query("select public.activate_subscription($1, 'TRX1')", [sub]); // idempotent
  const t = (await db.query("select * from public.tenants where id = $1", [tenantB])).rows[0];
  assert.equal(t.subscription_plan, "pro");
  assert.equal(t.subscription_status, "active");
  assert.ok(t.subscription_ends_at > new Date(Date.now() + 27 * 864e5));
  const after = (await db.query("select balance from public.sms_credits where tenant_id = $1", [tenantB])).rows[0].balance;
  assert.equal(after - before, 500);
});
