// Shared PGlite setup: real migrations + stubbed Supabase auth schema.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = new URL("../", import.meta.url);

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(new URL("tests/supabase-auth-stub.sql", root), "utf8"));
  const dir = new URL("supabase/migrations/", root);
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  const signUp = async (email, userMeta = {}, appMeta = {}) =>
    (await db.query(
      "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id",
      [email, userMeta, appMeta],
    )).rows[0].id;
  const asUser = (uid, fn) =>
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      await tx.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
      await tx.query("set local role authenticated");
      return fn(tx);
    });
  const tenantOf = async (uid) => (await db.query("select tenant_id from public.users where id = $1", [uid])).rows[0].tenant_id;
  return { db, signUp, asUser, tenantOf };
}
