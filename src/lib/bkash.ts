import "server-only";

/**
 * bKash Tokenized Checkout (v1.2.0-beta).
 * Flow: grant token → create payment → redirect customer to bkashURL →
 * bKash redirects back to our callback → execute payment → activate plan.
 */
const base = () => {
  const url = process.env.BKASH_BASE_URL;
  if (!url) throw new Error("BKASH_BASE_URL is not configured");
  return url.replace(/\/$/, "");
};

export function bkashConfigured() {
  return Boolean(process.env.BKASH_BASE_URL && process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET);
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function call<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    throw new Error(`bKash ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`bKash ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function grantToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const r = await call<{ id_token?: string; expires_in?: number; statusMessage?: string }>(
    "/tokenized/checkout/token/grant",
    { app_key: process.env.BKASH_APP_KEY, app_secret: process.env.BKASH_APP_SECRET },
    { username: process.env.BKASH_USERNAME ?? "", password: process.env.BKASH_PASSWORD ?? "" },
  );
  if (!r.id_token) throw new Error(`bKash token grant failed: ${r.statusMessage ?? "unknown"}`);
  tokenCache = { token: r.id_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
  return r.id_token;
}

async function authed<T>(path: string, body: unknown): Promise<T> {
  const token = await grantToken();
  return call<T>(path, body, { authorization: token, "x-app-key": process.env.BKASH_APP_KEY ?? "" });
}

export interface BkashCreateResult {
  paymentID?: string;
  bkashURL?: string;
  statusCode?: string;
  statusMessage?: string;
}

export async function createPayment(opts: { amount: number; invoice: string; payerReference: string; callbackURL: string }) {
  const r = await authed<BkashCreateResult>("/tokenized/checkout/create", {
    mode: "0011",
    payerReference: opts.payerReference,
    callbackURL: opts.callbackURL,
    amount: opts.amount.toFixed(2),
    currency: "BDT",
    intent: "sale",
    merchantInvoiceNumber: opts.invoice,
  });
  if (r.statusCode !== "0000" || !r.paymentID || !r.bkashURL) {
    throw new Error(`bKash create failed: ${r.statusMessage ?? r.statusCode ?? "unknown"}`);
  }
  return { paymentID: r.paymentID, bkashURL: r.bkashURL };
}

export interface BkashPaymentResult {
  paymentID?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  statusCode?: string;
  statusMessage?: string;
}

export async function executePayment(paymentID: string): Promise<BkashPaymentResult> {
  try {
    return await authed<BkashPaymentResult>("/tokenized/checkout/execute", { paymentID });
  } catch {
    // Execute can time out after bKash already completed it — ask for the status.
    return queryPayment(paymentID);
  }
}

export async function queryPayment(paymentID: string): Promise<BkashPaymentResult> {
  return authed<BkashPaymentResult>("/tokenized/checkout/payment/status", { paymentID });
}
