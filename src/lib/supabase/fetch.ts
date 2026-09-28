/**
 * Next.js 14 caches fetch() in server code by default — including the POSTs
 * supabase-js makes. A cached response would replay stale data (or a stale
 * reminder claim, re-sending SMS), so every server-side Supabase client
 * must bypass the Data Cache.
 */
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });
