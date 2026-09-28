import { redirect } from "next/navigation";

/** Redirect with a one-line flash message rendered by <Flash>. */
export function redirectWith(path: string, msg: { ok?: string; error?: string }): never {
  const [p, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  if (msg.ok) params.set("ok", msg.ok);
  if (msg.error) params.set("error", msg.error);
  redirect(`${p}?${params.toString()}`);
}

/** Map Postgres/PostgREST errors to something a shop owner can read. */
export function friendlyDbError(e: { message: string; code?: string } | null | undefined): string {
  if (!e) return "Something went wrong";
  if (e.code === "23505") return "This record already exists (duplicate phone number or value).";
  if (e.code === "42501") return "You don't have permission to do that.";
  if (e.code === "23503") return "A linked record was not found.";
  return e.message;
}
