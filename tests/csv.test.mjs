import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, parseMonths, validateRow, normalizeHeader, csvCell } from "../src/lib/csv.ts";
import { normalizeBdPhone } from "../src/lib/phone.ts";
import { addMonthsISO, daysBetween, expiryTone } from "../src/lib/dates.ts";

test("parseDate handles BD day-first formats", () => {
  assert.equal(parseDate("2025-03-14"), "2025-03-14");
  assert.equal(parseDate("14/03/2025"), "2025-03-14");
  assert.equal(parseDate("4-3-25"), "2025-03-04");
  assert.equal(parseDate("14 Mar 2025"), "2025-03-14");
  assert.equal(parseDate("31/02/2025"), null);
  assert.equal(parseDate("garbage"), null);
});

test("parseMonths", () => {
  assert.equal(parseMonths("12"), 12);
  assert.equal(parseMonths("2 years"), 24);
  assert.equal(parseMonths("1 yr"), 12);
  assert.equal(parseMonths(""), null);
  assert.ok(Number.isNaN(parseMonths("lifetime")));
});

test("headers are mapped from common spellings", () => {
  assert.equal(normalizeHeader("Mobile No"), "customer_phone");
  assert.equal(normalizeHeader("purchase_date"), "purchase_date");
  assert.equal(normalizeHeader("Serial No"), "serial_number");
  assert.equal(normalizeHeader("whatever"), null);
});

test("validateRow", () => {
  const ok = validateRow({ customer_name: "Karim", product_name: "AC", purchase_date: "31/01/2026", warranty_months: "1 year", amc_months: "12" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.row.warranty_months, 12);
  assert.equal(ok.row.amc_start_date, "2027-01-31");
  assert.match(validateRow({ customer_name: "K", product_name: "AC", purchase_date: "x" }).error, /purchase_date/);
  assert.match(validateRow({ customer_name: "K", product_name: "AC", purchase_date: "2026-01-01" }).error, /warranty_months or amc/);
});

test("csvCell escapes and blocks formula injection", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=HYPERLINK()"), "'=HYPERLINK()");
});

test("normalizeBdPhone", () => {
  assert.equal(normalizeBdPhone("01711-234567"), "8801711234567");
  assert.equal(normalizeBdPhone("+880 1711 234567"), "8801711234567");
  assert.equal(normalizeBdPhone("1711234567"), "8801711234567");
  assert.equal(normalizeBdPhone("01211234567"), null);
  assert.equal(normalizeBdPhone("12345"), null);
});

test("date helpers match Postgres month arithmetic", () => {
  assert.equal(addMonthsISO("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsISO("2024-02-29", 12), "2025-02-28");
  assert.equal(addMonthsISO("2026-03-15", 24), "2028-03-15");
  assert.equal(daysBetween("2026-01-01", "2026-01-08"), 7);
  assert.equal(expiryTone("2026-01-08", "2026-01-01"), "red");
  assert.equal(expiryTone("2026-01-20", "2026-01-01"), "yellow");
  assert.equal(expiryTone("2025-12-31", "2026-01-01"), "expired");
});

test("public link tokens round-trip and stay short", async () => {
  const { shortToken, parseToken } = await import("../src/lib/links.ts");
  const uuid = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
  const t = shortToken(uuid);
  assert.equal(t.length, 22);
  assert.equal(parseToken(t), uuid);
  assert.equal(parseToken(uuid), uuid);
  assert.equal(parseToken("../../etc"), null);
  assert.equal(parseToken("x".repeat(23)), null);
});

test("SMS templates render and validate", async () => {
  const { renderTemplate, validateTemplate, DEFAULT_TEMPLATE_EN } = await import("../src/lib/notify/templates.ts");
  const out = renderTemplate(DEFAULT_TEMPLATE_EN, {
    customer: "Karim", product: "AC", type: "warranty", when: "tomorrow", shop: "Shop", phone: "", link: "",
  });
  assert.equal(out, "Dear Karim, your AC warranty expires tomorrow. Renew: Shop");
  assert.equal(validateTemplate("Hi {customer}, {product} ends {date}"), null);
  assert.match(validateTemplate("Hi {nme} {product}"), /Unknown/);
  assert.match(validateTemplate("Hi {customer}"), /\{product\}/);
});
