import { formatDate } from "../dates";
import type { ReminderType } from "../types";
import { displayPhone } from "../phone";
import { DEFAULT_TEMPLATE_EN, renderTemplate } from "./templates";

/** 01XXXXXXXXX — shorter than 8801… and what customers recognise. */
export const localPhone = (p: string | null) => (p ? displayPhone(p).replace("-", "") : "");

export interface ReminderMessageInput {
  language: "en" | "bn";
  template?: string | null;
  customerName: string;
  productName: string;
  type: ReminderType;
  expiry: string;
  daysLeft: number;
  shopName: string;
  shopPhone: string | null;
  link: string | null;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bnNum = (n: number | string) => String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

function when(m: ReminderMessageInput): string {
  if (m.language === "bn") {
    if (m.daysLeft < 0) return `${bnNum(-m.daysLeft)} দিন আগে শেষ হয়েছে`;
    return m.daysLeft === 0 ? "আজ শেষ হবে" : `${bnNum(m.daysLeft)} দিন পর শেষ হবে`;
  }
  if (m.daysLeft < 0) return `on ${formatDate(m.expiry)} (expired)`;
  return m.daysLeft === 0 ? "today" : m.daysLeft === 1 ? "tomorrow" : `on ${formatDate(m.expiry)}`;
}

/** Customer-facing SMS/WhatsApp text. Kept short: every extra SMS part costs money. */
export function customerSms(m: ReminderMessageInput): string {
  const what = m.type === "amc" ? "AMC" : m.language === "bn" ? "ওয়ারেন্টি" : "warranty";
  const vars = {
    customer: m.customerName,
    product: m.productName,
    type: what,
    date: formatDate(m.expiry),
    days: String(Math.max(0, m.daysLeft)),
    shop: m.shopName,
    phone: localPhone(m.shopPhone),
    link: m.link ?? "",
    when: when(m),
  };
  if (m.template) return renderTemplate(m.template, vars);
  if (m.language === "bn") {
    return renderTemplate("{customer}, আপনার {product} এর {type} {when}। নবায়নে: {shop} {phone} {link}", vars);
  }
  return renderTemplate(DEFAULT_TEMPLATE_EN, vars);
}

/** Shop-owner copy (SMS). */
export function ownerSms(m: ReminderMessageInput & { customerPhone: string | null }): string {
  const what = m.type === "amc" ? "AMC" : "Warranty";
  const state = m.daysLeft < 0 ? `expired ${-m.daysLeft}d ago` : `expiring in ${m.daysLeft}d`;
  return `${what} ${state}: ${m.productName} - ${m.customerName}${m.customerPhone ? ` (${localPhone(m.customerPhone)})` : ""}, ${formatDate(m.expiry)}`;
}

export function reminderEmail(m: ReminderMessageInput, audience: "customer" | "owner", customerPhone?: string | null) {
  const what = m.type === "amc" ? "AMC" : "warranty";
  const left = m.daysLeft < 0 ? `expired ${-m.daysLeft} day(s) ago` : `${m.daysLeft} day(s) left`;
  if (audience === "owner") {
    return {
      subject: `[Reminder] ${m.productName} ${what} ${m.daysLeft < 0 ? "has expired" : `expires in ${m.daysLeft} day(s)`}`,
      text: [
        `${m.productName} (${what}) for ${m.customerName}${customerPhone ? `, ${localPhone(customerPhone)}` : ""} — expiry ${formatDate(m.expiry)}, ${left}.`,
        "",
        "This is a good time to call the customer about renewal.",
      ].join("\n"),
    };
  }
  return {
    subject: `Your ${m.productName} ${what} ${m.daysLeft < 0 ? "has expired" : `expires on ${formatDate(m.expiry)}`}`,
    text: [
      `Dear ${m.customerName},`,
      "",
      `The ${what} for your ${m.productName} ${m.daysLeft < 0 ? "expired" : "expires"} on ${formatDate(m.expiry)} (${left}).`,
      `To renew, please contact ${m.shopName}${m.shopPhone ? ` at ${localPhone(m.shopPhone)}` : ""}.`,
      m.link ? `\nView your warranty status or request a renewal call: ${m.link}` : "",
      "",
      `— ${m.shopName}`,
    ].join("\n"),
  };
}
