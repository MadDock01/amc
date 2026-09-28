/**
 * Normalise a Bangladeshi mobile number to 8801XXXXXXXXX.
 * Accepts 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX, with spaces/dashes.
 * Returns null when it isn't a valid BD mobile number.
 */
export function normalizeBdPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("1")) digits = "0" + digits;
  if (!/^01[3-9]\d{8}$/.test(digits)) return null;
  return "88" + digits;
}

/** Display form: 01XXX-XXXXXX */
export function displayPhone(p: string | null | undefined): string {
  if (!p) return "—";
  const n = normalizeBdPhone(p);
  if (!n) return p;
  const local = n.slice(2);
  return `${local.slice(0, 5)}-${local.slice(5)}`;
}
