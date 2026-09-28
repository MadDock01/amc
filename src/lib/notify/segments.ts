// Pure SMS part counting (shared by server sender and the settings preview).

// GSM-7 basic charset (+ extension chars count double). Anything else → UCS-2.
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

/** Number of SMS parts a message will be billed as. */
export function smsSegments(text: string): number {
  let unicode = false;
  let len = 0;
  for (const ch of text) {
    if (GSM7.includes(ch)) len += 1;
    else if (GSM7_EXT.includes(ch)) len += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    const n = [...text].length;
    return n <= 70 ? 1 : Math.ceil(n / 67);
  }
  return len <= 160 ? 1 : Math.ceil(len / 153);
}
