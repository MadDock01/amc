// Per-shop SMS templates. Pure (no imports) so it can be unit tested.

export const TEMPLATE_VARS = ["customer", "product", "type", "date", "days", "shop", "phone", "link"] as const;
export type TemplateVars = Record<(typeof TEMPLATE_VARS)[number], string>;

export const DEFAULT_TEMPLATE_EN = "Dear {customer}, your {product} {type} expires {when}. Renew: {shop} {phone} {link}";

/** Replace {var} placeholders; unknown placeholders are left as-is. Collapses doubled spaces. */
export function renderTemplate(template: string, vars: Partial<TemplateVars> & { when?: string }): string {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String((vars as Record<string, string>)[k] ?? "") : m))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?।])/g, "$1")
    .trim();
}

/** Returns an error message when a template is unusable, else null. */
export function validateTemplate(t: string): string | null {
  if (t.length > 480) return "Template is too long (max 480 characters).";
  const unknown = [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => ![...TEMPLATE_VARS, "when"].includes(k as never));
  if (unknown.length) return `Unknown placeholder(s): ${unknown.map((u) => `{${u}}`).join(", ")}`;
  if (!t.includes("{product}")) return "Template must include {product}.";
  return null;
}
