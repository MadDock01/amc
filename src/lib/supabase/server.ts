import { createServerClient } from "@supabase/ssr";
import { noStoreFetch } from "./fetch";
import { cookies } from "next/headers";

/** Supabase client acting as the signed-in user. All queries go through RLS. */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: noStoreFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: cookies are read-only there.
            // The middleware refreshes the session instead.
          }
        },
      },
    },
  );
}
