export const TZ = "Asia/Dhaka";

/** Today's date in Bangladesh as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add calendar months, clamping to the month end (Jan 31 + 1 month = Feb 28), like Postgres. */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}

export type ExpiryTone = "expired" | "red" | "yellow" | "green" | "none";

/** red = within 7 days, yellow = within 30 days. */
export function expiryTone(expiry: string | null, today = todayISO()): ExpiryTone {
  if (!expiry) return "none";
  const left = daysBetween(today, expiry);
  if (left < 0) return "expired";
  if (left <= 7) return "red";
  if (left <= 30) return "yellow";
  return "green";
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: iso.length === 10 ? "UTC" : TZ });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
}

/** The nearer of warranty / AMC expiry that is still relevant. */
export function nextExpiry(p: { warranty_expiry_date: string | null; amc_expiry_date: string | null }, today = todayISO()) {
  const dates = [
    p.warranty_expiry_date ? { type: "warranty" as const, date: p.warranty_expiry_date } : null,
    p.amc_expiry_date ? { type: "amc" as const, date: p.amc_expiry_date } : null,
  ].filter((x): x is { type: "warranty" | "amc"; date: string } => x !== null);
  const upcoming = dates.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (upcoming.length) return upcoming[0];
  return dates.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}
