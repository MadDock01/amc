import "server-only";

export interface WhatsAppResult {
  ok: boolean;
  providerResponse: string;
}

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * WhatsApp Cloud API. Business-initiated messages must use an approved
 * template, so we send WHATSAPP_TEMPLATE with body parameters:
 *   {{1}} customer  {{2}} product  {{3}} warranty/AMC  {{4}} expiry date
 *   {{5}} shop      {{6}} shop phone
 * Without credentials it logs instead (development).
 */
export async function sendWhatsApp(to: string, params: string[], preview: string): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    console.log(`[whatsapp:console] to=${to} ${JSON.stringify(preview)}`);
    return { ok: true, providerResponse: "console" };
  }
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE ?? "warranty_reminder",
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text || "-" })) }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    return { ok: res.ok, providerResponse: (await res.text()).slice(0, 1000) };
  } catch (e) {
    return { ok: false, providerResponse: `request error: ${(e as Error).message}` };
  }
}
