import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Supabase runs every request that comes through its API with the safeupdate guard, which refuses an UPDATE or DELETE
// without a WHERE clause, also inside functions. The local test database has no such guard, so this checks the
// migrations instead: in every database function as it ends up after all migrations, each UPDATE ... SET and DELETE FROM
// must have a WHERE (for a deliberate full wipe, "where true").

const dir = new URL("../../supabase/migrations/", import.meta.url);

/** UPDATE/DELETE statements in a function body that have no WHERE. */
function unguarded(body: string): string[] {
  const code = body.replace(/--[^\n]*/g, "");
  const statements = code.match(/^\s*(?:update\s+[a-z_.]+(?:\s+[a-z_]+)?\s+set\b|delete\s+from\s+[a-z_.]+)[\s\S]*?;/gim) ?? [];
  return statements.filter((s) => !/\bwhere\b/i.test(s)).map((s) => s.trim().replace(/\s+/g, " ").slice(0, 120));
}

/** Each function's body as it stands after running the given migrations in order (later ones replace, drops remove). */
function finalFunctions(migrations: string[]): Map<string, string> {
  const fns = new Map<string, string>();
  for (const sql of migrations) {
    const events = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_.]+)\s*\([\s\S]*?(\$\$[\s\S]*?\$\$)|drop\s+function\s+(?:if\s+exists\s+)?([a-z_.]+)/gi)];
    for (const e of events) {
      if (e[3]) fns.delete(e[3].toLowerCase());
      else fns.set(e[1].toLowerCase(), e[2]);
    }
  }
  return fns;
}

test("the check spots a missing WHERE, accepts where true, and follows replaced and dropped functions", () => {
  assert.deepEqual(unguarded("$$\n  delete from public.t;\n$$"), ["delete from public.t;"]);
  assert.deepEqual(unguarded("$$\n  delete from public.t where true;\n  update public.s set a = 1 where id;\n  -- delete from public.u;\n  insert into t values (1) on conflict (id) do update set a = 1;\n$$"), []);
  const fns = finalFunctions([
    "create function public.f() returns void language sql as $$\n  delete from public.t;\n$$;\ncreate function public.g() returns void language sql as $$\n  delete from public.t;\n$$;",
    "create or replace function public.f() returns void language sql as $$\n  delete from public.t where true;\n$$;\ndrop function if exists public.g();",
  ]);
  assert.deepEqual([...fns.keys()], ["public.f"]);
  assert.deepEqual(unguarded(fns.get("public.f")!), []);
});

test("every UPDATE and DELETE in the database functions has a WHERE (Supabase refuses them otherwise)", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length > 0, "found the migrations");
  const fns = finalFunctions(files.map((f) => readFileSync(new URL(f, dir), "utf8")));
  assert.ok(fns.has("public.factory_reset"), "found the factory reset");
  const problems = [...fns].flatMap(([name, body]) => unguarded(body).map((s) => `${name}: ${s}`));
  assert.deepEqual(problems, []);
});
