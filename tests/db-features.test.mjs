import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./db-helpers.mjs";

let h, owner, staffBranch, staffAll, tenant, branchA, branchB, customer, other;

before(async () => {
  h = await createDb();
  owner = await h.signUp("o@x.test", { business_name: "Multi" });
  tenant = await h.tenantOf(owner);
  await h.db.query("update public.tenants set subscription_plan = 'enterprise', subscription_ends_at = now() + interval '30 days' where id = $1", [tenant]);
  await h.asUser(owner, async (tx) => {
    branchA = (await tx.query("insert into public.branches (name) values ('Dhaka') returning id")).rows[0].id;
    branchB = (await tx.query("insert into public.branches (name) values ('Ctg') returning id")).rows[0].id;
    customer = (await tx.query("insert into public.customers (name, phone) values ('C', '8801711111111') returning id")).rows[0].id;
    await tx.query("insert into public.products (customer_id, product_name, purchase_date, warranty_months, branch_id) values ($1, 'In A', current_date, 12, $2)", [customer, branchA]);
    await tx.query("insert into public.products (customer_id, product_name, purchase_date, warranty_months, branch_id) values ($1, 'In B', current_date, 12, $2)", [customer, branchB]);
  });
  staffBranch = await h.signUp("sb@x.test", {}, { tenant_id: tenant, role: "staff" });
  await h.db.query("update public.users set branch_id = $2 where id = $1", [staffBranch, branchA]);
  staffAll = await h.signUp("sa@x.test", {}, { tenant_id: tenant, role: "staff" });
  other = await h.signUp("other@x.test", { business_name: "Other" });
});

test("branch-scoped staff only see and create products in their branch", async () => {
  await h.asUser(staffBranch, async (tx) => {
    const rows = (await tx.query("select product_name from public.products")).rows.map((r) => r.product_name);
    assert.deepEqual(rows, ["In A"]);
    const p = (await tx.query("insert into public.products (customer_id, product_name, purchase_date, warranty_months) values ($1, 'New', current_date, 6) returning branch_id", [customer])).rows[0];
    assert.equal(p.branch_id, branchA, "defaults to the staff member's branch");
  });
  await assert.rejects(h.asUser(staffBranch, (tx) =>
    tx.query("insert into public.products (customer_id, product_name, purchase_date, warranty_months, branch_id) values ($1, 'x', current_date, 6, $2)", [customer, branchB])));
  await assert.rejects(h.asUser(staffBranch, (tx) => tx.query("update public.users set branch_id = null where id = $1", [staffBranch])), /role or tenant/);
  await h.asUser(staffAll, async (tx) => {
    assert.equal((await tx.query("select * from public.products")).rows.length, 3);
  });
});

test("only owners manage branches; other tenants can't use them", async () => {
  await h.asUser(staffAll, async (tx) => {
    const r = await tx.query("update public.branches set name = 'x'");
    assert.equal(r.affectedRows, 0);
  });
  await assert.rejects(h.asUser(staffAll, (tx) => tx.query("insert into public.branches (name) values ('Sylhet')")));
  await assert.rejects(h.asUser(other, async (tx) => {
    const c = (await tx.query("insert into public.customers (name) values ('o') returning id")).rows[0].id;
    await tx.query("insert into public.products (customer_id, product_name, purchase_date, warranty_months, branch_id) values ($1, 'x', current_date, 6, $2)", [c, branchA]);
  }));
});

test("follow-ups: attributed to the caller, logged in activity", async () => {
  const pid = (await h.db.query("select id from public.products where product_name = 'In A'")).rows[0].id;
  await h.asUser(staffAll, (tx) => tx.query("insert into public.product_followups (product_id, outcome, note) values ($1, 'contacted', 'called')", [pid]));
  await assert.rejects(h.asUser(staffAll, (tx) =>
    tx.query("insert into public.product_followups (product_id, outcome, created_by) values ($1, 'note', $2)", [pid, owner])));
  const logs = (await h.db.query("select action, entity from public.activity_logs where tenant_id = $1 and entity = 'product_followups'", [tenant])).rows;
  assert.equal(logs.length, 1);
  // staff can't read the audit log; owner can
  await h.asUser(staffAll, async (tx) => assert.equal((await tx.query("select * from public.activity_logs")).rows.length, 0));
  await h.asUser(owner, async (tx) => assert.ok((await tx.query("select * from public.activity_logs")).rows.length > 3));
  await assert.rejects(h.asUser(owner, (tx) => tx.query("insert into public.activity_logs (tenant_id, action) values ($1, 'fake')", [tenant])));
});

test("daily SMS cap and credits", async () => {
  await h.db.query("update public.tenants set sms_daily_cap = 5 where id = $1", [tenant]);
  await h.db.query("select public.add_sms_credits($1, 100)", [tenant]);
  const call = async (n) => (await h.db.query("select public.consume_sms_credits_capped($1, $2) as r", [tenant, n])).rows[0].r;
  assert.equal(await call(3), "ok");
  assert.equal(await call(3), "daily_cap");
  assert.equal(await call(2), "ok");
  await h.db.query("select public.refund_sms_credits($1, 2)", [tenant]);
  assert.equal(await call(2), "ok");
  assert.equal(await call(1000), "insufficient");
});

test("manual reminders bypass de-dup; whatsapp generated when enabled", async () => {
  const pid = (await h.db.query("select id, warranty_expiry_date from public.products where product_name = 'In A'")).rows[0];
  const exp = pid.warranty_expiry_date.toISOString().slice(0, 10);
  await h.db.query("update public.tenants set whatsapp_enabled = true where id = $1", [tenant]);
  const runDate = (await h.db.query("select ($1::date - 7)::text as d", [exp])).rows[0].d;
  await h.db.query("select public.generate_due_reminders($1::date)", [runDate]);
  const chans = (await h.db.query("select channel from public.reminders where product_id = $1 and not is_manual order by channel", [pid.id])).rows.map((r) => r.channel);
  assert.deepEqual(chans, ["sms", "email", "whatsapp"]); // enum order
  assert.equal((await h.db.query("select public.generate_due_reminders($1::date) as n", [runDate])).rows[0].n, 0);
  for (let i = 0; i < 2; i++) {
    await h.db.query(
      "insert into public.reminders (tenant_id, product_id, reminder_type, days_before, expiry_date, scheduled_date, channel, is_manual) values ($1, $2, 'warranty', 0, $3, current_date, 'sms', true)",
      [tenant, pid.id, exp]);
  }
  const ids = (await h.db.query("select array_agg(id) as ids from public.reminders where is_manual")).rows[0].ids;
  assert.equal((await h.db.query("select * from public.claim_reminders_by_id($1)", [ids])).rows.length, 2);
  await assert.rejects(h.db.query(
    "insert into public.reminders (tenant_id, product_id, reminder_type, days_before, expiry_date, scheduled_date, channel) values ($1, $2, 'warranty', 0, $3, current_date, 'sms')",
    [tenant, pid.id, exp]), /days_before/);
});

test("SMS pack payments add credits without touching the plan", async () => {
  const before = (await h.db.query("select balance from public.sms_credits where tenant_id = $1", [tenant])).rows[0].balance;
  const sub = (await h.db.query("insert into public.subscriptions (tenant_id, plan, amount, kind, sms_pack_size) values ($1, 'enterprise', 250, 'sms_pack', 500) returning id, invoice_no", [tenant])).rows[0];
  assert.ok(Number(sub.invoice_no) > 0);
  await h.db.query("select public.activate_subscription($1, 'T')", [sub.id]);
  const after = (await h.db.query("select balance from public.sms_credits where tenant_id = $1", [tenant])).rows[0].balance;
  assert.equal(after - before, 500);
  const t = (await h.db.query("select subscription_plan from public.tenants where id = $1", [tenant])).rows[0];
  assert.equal(t.subscription_plan, "enterprise");
});

test("yearly plan runs a year and grants 12x the bundle", async () => {
  const t2 = await h.tenantOf(other);
  const before = (await h.db.query("select balance from public.sms_credits where tenant_id = $1", [t2])).rows[0].balance;
  const sub = (await h.db.query("insert into public.subscriptions (tenant_id, plan, amount, billing_cycle) values ($1, 'basic', 5000, 'yearly') returning id", [t2])).rows[0].id;
  await h.db.query("select public.activate_subscription($1, 'T2')", [sub]);
  const t = (await h.db.query("select subscription_ends_at from public.tenants where id = $1", [t2])).rows[0];
  assert.ok(t.subscription_ends_at > new Date(Date.now() + 360 * 864e5));
  const after = (await h.db.query("select balance from public.sms_credits where tenant_id = $1", [t2])).rows[0].balance;
  assert.equal(after - before, 1200);
});

test("api keys and renewal requests are not writable by end users directly", async () => {
  await assert.rejects(h.asUser(owner, (tx) => tx.query("insert into public.api_keys (tenant_id, name, key_prefix, key_hash) values ($1, 'k', 'p', 'h')", [tenant])));
  await assert.rejects(h.asUser(owner, async (tx) => {
    const pid = (await tx.query("select id from public.products limit 1")).rows[0].id;
    await tx.query("insert into public.renewal_requests (tenant_id, product_id) values ($1, $2)", [tenant, pid]);
  }));
  const pid = (await h.db.query("select id from public.products where tenant_id = $1 limit 1", [tenant])).rows[0].id;
  await h.db.query("insert into public.renewal_requests (tenant_id, product_id, message) values ($1, $2, 'please call')", [tenant, pid]);
  await h.asUser(staffAll, async (tx) => {
    assert.equal((await tx.query("select * from public.renewal_requests")).rows.length, 1);
    assert.equal((await tx.query("update public.renewal_requests set status = 'handled'")).affectedRows, 1);
  });
  await h.asUser(other, async (tx) => assert.equal((await tx.query("select * from public.renewal_requests")).rows.length, 0));
});

test("deleting a tenant cascades cleanly (activity trigger doesn't block it)", async () => {
  await h.db.query("delete from public.tenants where id = $1", [tenant]);
  assert.equal((await h.db.query("select count(*)::int n from public.products where tenant_id = $1", [tenant])).rows[0].n, 0);
});
