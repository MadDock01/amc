import "server-only";

export interface EmailResult {
  ok: boolean;
  providerResponse: string;
}

/** Send a plain-text email through Resend. Without RESEND_API_KEY it logs instead (dev). */
export async function sendEmail(to: string, subject: string, text: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:console] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    return { ok: true, providerResponse: "console" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    return { ok: res.ok, providerResponse: (await res.text()).slice(0, 1000) };
  } catch (e) {
    return { ok: false, providerResponse: `request error: ${(e as Error).message}` };
  }
}
