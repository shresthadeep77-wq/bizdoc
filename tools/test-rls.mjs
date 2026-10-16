#!/usr/bin/env node
/**
 * Runs the Supabase migration and the two-user RLS test against a real
 * Postgres, locally, with nothing to install system-wide.
 *
 *   npm install --prefix .cache/pglite --no-save @electric-sql/pglite@0.5.8
 *   node tools/test-rls.mjs
 *
 * PGlite is Postgres compiled to WebAssembly. It is a test aid only — the app
 * never loads it — so it lives in .cache/ (gitignored) rather than becoming a
 * project dependency.
 *
 * Supabase provides a few things a bare Postgres does not: the anon and
 * authenticated roles, auth.users, auth.uid(), and default privileges that
 * grant every new table to anon and authenticated. The shim below recreates
 * exactly those, including the permissive defaults, so a missing REVOKE in the
 * migration shows up here as a failure rather than passing by accident.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(ROOT, ".cache", "pglite", "node_modules", "_"));

let PGlite;
try {
  ({ PGlite } = req("@electric-sql/pglite"));
} catch (e) {
  console.error("PGlite is not installed. Run:\n  npm install --prefix .cache/pglite --no-save @electric-sql/pglite@0.5.8");
  process.exit(2);
}

const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  aud text,
  role text
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const migration = readFileSync(join(ROOT, "supabase", "migrations", "20261016000000_bizdoc_cloud_sync.sql"), "utf8");
const test = readFileSync(join(ROOT, "supabase", "tests", "rls_two_users.sql"), "utf8");

const db = new PGlite();
try {
  await db.exec(SUPABASE_SHIM);
  await db.exec(migration);
  // Twice: the migration must be safe to re-run.
  await db.exec(migration);
  console.log("migration applied (and re-applied) cleanly");

  const results = await db.exec(test);
  const last = results[results.length - 1];
  const verdict = last && last.rows && last.rows[0] && last.rows[0].result;
  if (verdict !== "ALL RLS CHECKS PASSED") throw new Error("test did not reach its final check");
  console.log(verdict);

  // The test ends in ROLLBACK; prove it left nothing behind.
  const left = await db.query("select (select count(*) from public.bizdoc_businesses) + (select count(*) from auth.users) as n");
  if (Number(left.rows[0].n) !== 0) throw new Error("test left rows behind");
  console.log("rollback left no rows behind");
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
