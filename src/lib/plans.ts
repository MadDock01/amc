import type { Plan } from "./types";

// Keep limits in sync with plan_product_limit()/plan_sms_bundle() in the SQL migration.
export const PLANS: Record<
  Plan,
  { name: string; priceBdt: number | null; productLimit: number | null; smsBundle: number; maxStaff: number | null; blurb: string }
> = {
  trial: { name: "Trial", priceBdt: 0, productLimit: 25, smsBundle: 10, maxStaff: 1, blurb: "Free for 14 days, up to 25 products" },
  basic: { name: "Basic", priceBdt: 500, productLimit: 100, smsBundle: 100, maxStaff: 1, blurb: "100 products, 100 SMS/month" },
  pro: { name: "Pro", priceBdt: 1200, productLimit: 500, smsBundle: 500, maxStaff: 10, blurb: "500 products, 500 SMS/month, multi-staff" },
  enterprise: { name: "Enterprise", priceBdt: null, productLimit: null, smsBundle: 2000, maxStaff: null, blurb: "Unlimited, multi-branch, API access" },
};

export const PAID_PLANS = ["basic", "pro"] as const;

/** Monthly recurring revenue contributed by a plan (enterprise is custom → 0 unless set). */
export function monthlyPrice(plan: Plan): number {
  return PLANS[plan].priceBdt ?? 0;
}

/** Choices offered in Settings → reminder days. */
export const REMINDER_DAY_OPTIONS = [60, 45, 30, 15, 7, 3, 1];

export type Feature = "whatsapp" | "branches" | "api" | "templates";

const FEATURES: Record<Plan, Feature[]> = {
  trial: ["templates", "whatsapp"],
  basic: ["templates"],
  pro: ["templates", "whatsapp"],
  enterprise: ["templates", "whatsapp", "branches", "api"],
};

export function hasFeature(plan: Plan, f: Feature): boolean {
  return FEATURES[plan].includes(f);
}

/** Yearly = 10 months' price (2 months free). */
export function yearlyPrice(plan: Plan): number | null {
  const p = PLANS[plan].priceBdt;
  return p === null ? null : p * 10;
}

/** SMS top-up packs, bought with bKash. */
export const SMS_PACKS = [
  { id: "sms500", sms: 500, priceBdt: 250 },
  { id: "sms1000", sms: 1000, priceBdt: 450 },
  { id: "sms5000", sms: 5000, priceBdt: 2000 },
] as const;
