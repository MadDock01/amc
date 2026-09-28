import "server-only";

export interface SmsResult {
  ok: boolean;
  providerResponse: string;
}

export { smsSegments } from "./segments";

export function smsCostPerSegment(): number {
  return Number(process.env.SMS_COST_PER_MESSAGE ?? "0.35") || 0;
}

type Provider = (to: string, message: string) => Promise<SmsResult>;

async function readBody(res: Response) {
  const text = await res.text();
  return text.slice(0, 1000);
}

/** Alpha Net / sms.net.bd — https://api.sms.net.bd/sendsms */
const alpha: Provider = async (to, message) => {
  const url = process.env.SMS_API_URL || "https://api.sms.net.bd/sendsms";
  const body = new URLSearchParams({ api_key: process.env.SMS_API_KEY ?? "", msg: message, to });
  if (process.env.SMS_SENDER_ID) body.set("sender_id", process.env.SMS_SENDER_ID);
  const res = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const raw = await readBody(res);
  let ok = res.ok;
  try {
    const json = JSON.parse(raw);
    ok = ok && (json.error === 0 || json.error === "0");
  } catch {
    ok = false;
  }
  return { ok, providerResponse: raw };
};

/** MiMSMS JSON API. Verify field names against your MiMSMS account docs. */
const mimsms: Provider = async (to, message) => {
  const url = process.env.SMS_API_URL || "https://api.mimsms.com/api/SmsSending/SMS";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      UserName: process.env.SMS_USERNAME ?? "",
      Apikey: process.env.SMS_API_KEY ?? "",
      MobileNumber: to,
      CampaignId: "null",
      SenderName: process.env.SMS_SENDER_ID ?? "",
      TransactionType: "T",
      Message: message,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const raw = await readBody(res);
  let ok = res.ok;
  try {
    const json = JSON.parse(raw);
    ok = ok && (json.statusCode === "200" || json.statusCode === 200 || json.status === "Success");
  } catch {
    ok = false;
  }
  return { ok, providerResponse: raw };
};

/** Development: log instead of sending. */
const consoleProvider: Provider = async (to, message) => {
  console.log(`[sms:console] to=${to} ${JSON.stringify(message)}`);
  return { ok: true, providerResponse: "console" };
};

const PROVIDERS: Record<string, Provider> = { alpha, mimsms, console: consoleProvider };

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const name = process.env.SMS_PROVIDER || "console";
  const provider = PROVIDERS[name];
  if (!provider) return { ok: false, providerResponse: `Unknown SMS_PROVIDER "${name}"` };
  try {
    return await provider(to, message);
  } catch (e) {
    return { ok: false, providerResponse: `request error: ${(e as Error).message}` };
  }
}
