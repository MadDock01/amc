// Pure helpers shared by the CSV importer (client preview + server action).

export const IMPORT_COLUMNS = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "product_name",
  "category",
  "serial_number",
  "purchase_date",
  "warranty_months",
  "amc_start_date",
  "amc_months",
  "notes",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type RawRow = Partial<Record<ImportColumn, string>>;

export interface ImportRow {
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  product_name: string;
  category: string | null;
  serial_number: string | null;
  purchase_date: string;
  warranty_months: number;
  amc_start_date: string | null;
  amc_months: number | null;
  notes: string | null;
}

// Common header spellings from shop Excel sheets → our column names.
const ALIASES: Record<string, ImportColumn> = {
  customer: "customer_name", name: "customer_name", "customer name": "customer_name", client: "customer_name",
  phone: "customer_phone", mobile: "customer_phone", "mobile no": "customer_phone", "phone number": "customer_phone", "customer phone": "customer_phone",
  email: "customer_email", "customer email": "customer_email",
  product: "product_name", item: "product_name", model: "product_name", "product name": "product_name",
  serial: "serial_number", "serial no": "serial_number", sn: "serial_number", "serial number": "serial_number",
  "purchase date": "purchase_date", date: "purchase_date", "sale date": "purchase_date", "invoice date": "purchase_date",
  warranty: "warranty_months", "warranty months": "warranty_months", "warranty (months)": "warranty_months",
  "amc start": "amc_start_date", "amc start date": "amc_start_date",
  amc: "amc_months", "amc months": "amc_months", "amc (months)": "amc_months",
  remarks: "notes", note: "notes",
};

export function normalizeHeader(h: string): ImportColumn | null {
  const k = h.trim().toLowerCase().replace(/\s+/g, " ");
  const snake = k.replace(/ /g, "_");
  if ((IMPORT_COLUMNS as readonly string[]).includes(snake)) return snake as ImportColumn;
  return ALIASES[k] ?? null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Accepts 2025-03-14, 14/03/2025, 14-03-2025, 14.03.2025, 14-Mar-2025. Day-first (BD convention). */
export function parseDate(input: string | undefined | null): string | null {
  if (!input) return null;
  const s = input.trim();
  let y: number, m: number, d: number;
  let match;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})$/))) {
    d = +match[1];
    m = MONTHS[match[2].toLowerCase()];
    y = +match[3];
    if (!m) return null;
  } else return null;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "12", "12 months", "1 year", "2 yrs" → months */
export function parseMonths(input: string | undefined | null): number | null {
  if (!input || !input.trim()) return null;
  const s = input.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|mon|month|months)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  const months = m[2] && m[2].startsWith("y") ? n * 12 : n;
  return Math.round(months);
}

const clean = (v: string | undefined | null) => (v && v.trim() ? v.trim() : null);

export function validateRow(raw: RawRow): { row?: ImportRow; error?: string } {
  const customer_name = clean(raw.customer_name);
  const product_name = clean(raw.product_name);
  if (!customer_name) return { error: "customer_name is required" };
  if (!product_name) return { error: "product_name is required" };
  const purchase_date = parseDate(raw.purchase_date);
  if (!purchase_date) return { error: `invalid purchase_date "${raw.purchase_date ?? ""}"` };
  const warranty = parseMonths(raw.warranty_months) ?? 0;
  if (Number.isNaN(warranty) || warranty < 0 || warranty > 600) return { error: `invalid warranty_months "${raw.warranty_months}"` };
  const amc_months = parseMonths(raw.amc_months);
  if (amc_months !== null && (Number.isNaN(amc_months) || amc_months < 1 || amc_months > 600))
    return { error: `invalid amc_months "${raw.amc_months}"` };
  let amc_start_date = parseDate(raw.amc_start_date);
  if (raw.amc_start_date && raw.amc_start_date.trim() && !amc_start_date) return { error: `invalid amc_start_date "${raw.amc_start_date}"` };
  if (amc_months && !amc_start_date) {
    // AMC without a start date → assume it starts when the warranty ends
    const [y, m, d] = purchase_date.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + warranty, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(d, last));
    amc_start_date = t.toISOString().slice(0, 10);
  }
  if (amc_start_date && !amc_months) return { error: "amc_start_date given without amc_months" };
  if (!warranty && !amc_months) return { error: "needs warranty_months or amc_months" };
  const email = clean(raw.customer_email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: `invalid email "${email}"` };
  return {
    row: {
      customer_name,
      customer_phone: clean(raw.customer_phone),
      customer_email: email,
      product_name,
      category: clean(raw.category),
      serial_number: clean(raw.serial_number),
      purchase_date,
      warranty_months: warranty,
      amc_start_date,
      amc_months,
      notes: clean(raw.notes),
    },
  };
}

/** Quote a value for CSV output. Prefixes formula-looking cells to prevent CSV injection in Excel. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
