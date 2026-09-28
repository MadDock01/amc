import { formatDate } from "../dates";
import type { ReminderType } from "../types";
import { displayPhone } from "../phone";

/** 01XXXXXXXXX — shorter than 8801… and what customers recognise. */
const localPhone = (p: string | null) => (p ? displayPhone(p).replace("-", "") : "");

export interface ReminderMessageInput {
  language: "en" | "bn";
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

/** Customer-facing SMS text. Kept short: every extra SMS segment costs money. */
export function customerSms(m: ReminderMessageInput): string {
  const what = m.type === "amc" ? "AMC" : m.language === "bn" ? "ওয়ারেন্টি" : "warranty";
  const contact = m.shopPhone ? ` ${localPhone(m.shopPhone)}` : "";
  const link = m.link ? ` ${m.link}` : "";
  if (m.language === "bn") {
    const when = m.daysLeft <= 0 ? "আজ" : `${bnNum(m.daysLeft)} দিন পর`;
    return `${m.customerName}, আপনার ${m.productName} এর ${what} ${when} শেষ হবে। নবায়নে: ${m.shopName}${contact}${link}`;
  }
  const when = m.daysLeft <= 0 ? "today" : m.daysLeft === 1 ? "tomorrow" : `on ${formatDate(m.expiry)}`;
  return `Dear ${m.customerName}, your ${m.productName} ${what} expires ${when}. Renew: ${m.shopName}${contact}${link}`;
}

/** Shop-owner copy (SMS). */
export function ownerSms(m: ReminderMessageInput & { customerPhone: string | null }): string {
  const what = m.type === "amc" ? "AMC" : "Warranty";
  return `${what} expiring in ${m.daysLeft}d: ${m.productName} - ${m.customerName}${m.customerPhone ? ` (${localPhone(m.customerPhone)})` : ""}, ${formatDate(m.expiry)}`;
}

export function reminderEmail(m: ReminderMessageInput, audience: "customer" | "owner", customerPhone?: string | null) {
  const what = m.type === "amc" ? "AMC" : "warranty";
  if (audience === "owner") {
    return {
      subject: `[Reminder] ${m.productName} ${what} expires in ${m.daysLeft} day(s)`,
      text: [
        `${m.productName} (${what}) for ${m.customerName}${customerPhone ? `, ${localPhone(customerPhone)}` : ""} expires on ${formatDate(m.expiry)} — ${m.daysLeft} day(s) left.`,
        "",
        "This is a good time to call the customer about renewal.",
      ].join("\n"),
    };
  }
  return {
    subject: `Your ${m.productName} ${what} expires on ${formatDate(m.expiry)}`,
    text: [
      `Dear ${m.customerName},`,
      "",
      `The ${what} for your ${m.productName} expires on ${formatDate(m.expiry)} (${m.daysLeft} day(s) left).`,
      `To renew, please contact ${m.shopName}${m.shopPhone ? ` at ${localPhone(m.shopPhone)}` : ""}.`,
      m.link ? `\nView your warranty status: ${m.link}` : "",
      "",
      `— ${m.shopName}`,
    ].join("\n"),
  };
}
