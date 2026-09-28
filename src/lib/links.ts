// Public warranty-status links. The token is the product's random UUID,
// shortened to 22 base64url chars so reminder SMS stay within one part.

export function shortToken(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ""), "hex").toString("base64url");
}

/** Accepts a short token or a full UUID; returns the UUID or null. */
export function parseToken(token: string): string | null {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return token.toLowerCase();
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const hex = Buffer.from(token, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function publicLinkFor(token: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return base ? `${base.replace(/\/$/, "")}/w/${shortToken(token)}` : null;
}
