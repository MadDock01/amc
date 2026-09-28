import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets, the public warranty page and cron/webhook APIs.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|w/|api/cron|api/bkash|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
