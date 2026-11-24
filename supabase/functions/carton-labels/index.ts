// Edge Function `carton-labels`: carton labels come from the VRPRIME inventory software, so the warehouse's own
// scanner knows every carton a supplier sends.
//
// Called only by the database (pg_net), never by a browser:
//   { "job": "issue", "dispatch_id": "<uuid>" }  print the labels a dispatch still needs, 50 at a time, saving each batch
//   { "job": "receive" }                         every 30 minutes: see which loaded cartons the warehouse has scanned in
//
// It asks the inventory software for exactly two things (see labels-api.ts): print labels, and read label states (a
// product's list, and one label by its number for those too old to be in the list). It never scans, never does inbound,
// never retires a label, never changes a product or stock.
//
// Every request must carry `x-internal-secret`, which this function checks with the database, so "Verify JWT" is off.
// Secrets: VRPRIME_API_USERNAME and VRPRIME_API_PASSWORD (the same ones the stock sync uses).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createLabelsClient, findArrivals, MAX_PER_REQUEST, type Wait } from "./labels-api.ts";

const SECRET_ENV_NAMES = ["VRPRIME_API_PASSWORD", "VRPRIME_API_USERNAME"];

function scrub(input: unknown): string {
  let text = String(input ?? "");
  for (const name of SECRET_ENV_NAMES) {
    const value = Deno.env.get(name)?.trim();
    if (value && value.length >= 4) text = text.split(value).join("[redacted]");
  }
  return text
    .replace(/(?:Bearer|Basic)\s+[^\s"'`,;)]+/gi, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[^\s"'`,;)]*/gi, "[redacted]")
    .replace(/eyJ[\w-]{5,}(?:\.[\w-]+){0,2}/g, "[redacted]");
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {
    // Fall back to the legacy key below.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function api() {
  const username = Deno.env.get("VRPRIME_API_USERNAME")?.trim();
  const password = Deno.env.get("VRPRIME_API_PASSWORD")?.trim();
  if (!username || !password) throw new Error("The inventory software login is not set up yet");
  const client = createLabelsClient({ username, password, baseUrl: Deno.env.get("VRPRIME_API_BASE_URL")?.trim() || undefined });
  await client.login();
  return client;
}

type Line = { product_id: string; sku: string; carton_type: string; units: number; need: number; weight: number | string | null };

/** Prints and saves the labels a dispatch still needs. Each batch is saved at once, so a stop half way loses nothing. */
async function issue(db: SupabaseClient, dispatchId: string): Promise<string> {
  const { data: plan, error } = await db.rpc("supplier_labels_claim", { p_dispatch: dispatchId });
  if (error) throw new Error(`Reading the dispatch: ${error.message}`);
  if (!plan) return "nothing to do";
  const { warehouse_vid, lines } = plan as { warehouse_vid: string; lines: Line[] };
  let made = 0;
  let problem: string | null = null;
  try {
    const inventory = await api();
    for (const line of lines) {
      let need = line.need;
      while (need > 0) {
        const weight = line.weight === null || line.weight === undefined ? null : Number(line.weight);
        const labels = await inventory.print(line.sku, warehouse_vid, Math.min(MAX_PER_REQUEST, need), line.units, weight);
        const { error: saveError } = await db.rpc("supplier_labels_save", {
          p_dispatch: dispatchId,
          p_rows: labels.map((l) => ({ product_id: line.product_id, carton_type: line.carton_type, units: line.units, serial: l.serial, svg: l.svg })),
        });
        if (saveError) throw new Error(`Saving ${labels.length} labels of ${line.sku}: ${saveError.message}`);
        made += labels.length;
        need -= labels.length;
      }
    }
  } catch (e) {
    problem = scrub(e instanceof Error ? e.message : e);
  }
  await db.rpc("supplier_labels_done", { p_dispatch: dispatchId, p_error: problem });
  if (problem) throw new Error(`${problem} (after ${made} labels)`);
  return `printed ${made} labels`;
}

/**
 * Marks the loaded cartons the warehouse has scanned in: each product's label list once, then, one by one, the labels too
 * old to be in it (the list holds a product's newest 50 only).
 */
async function receive(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc("supplier_receive_plan");
  if (error) throw new Error(`Reading the cartons on their way: ${error.message}`);
  const waits = (data ?? []) as Wait[];
  let found: Awaited<ReturnType<typeof findArrivals>> = { arrived: [], lookedUp: 0, unknown: 0, otherWarehouse: 0, failed: 0, left: 0 };
  if (waits.length) found = await findArrivals(waits, await api());
  // Called even with nothing arrived: it also flags dispatches that are overdue.
  const { data: saved, error: saveError } = await db.rpc("supplier_receive_save", { p_serials: found.arrived });
  if (saveError) throw new Error(`Saving the arrivals: ${saveError.message}`);
  const { lookedUp, unknown, otherWarehouse, failed, left } = found;
  return (
    `waiting on ${waits.reduce((n, w) => n + w.serials.length, 0)} cartons; ` +
    `looked up ${lookedUp} older labels one by one (unknown ${unknown}, other warehouse ${otherWarehouse}, failed ${failed}, left for the next run ${left}); ` +
    JSON.stringify(saved)
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const db = adminClient();
    const { data: allowed, error: authError } = await db.rpc("check_internal_secret", { candidate: req.headers.get("x-internal-secret") ?? "" });
    if (authError) {
      console.error("Secret check failed:", scrub(authError.message));
      return json({ ok: false, error: "could not verify the request" }, 500);
    }
    if (allowed !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    let work: Promise<string>;
    if (body?.job === "issue" && typeof body.dispatch_id === "string" && /^[0-9a-f-]{36}$/i.test(body.dispatch_id)) work = issue(db, body.dispatch_id);
    else if (body?.job === "receive") work = receive(db);
    else return json({ ok: false, error: "unknown job" }, 400);

    const logged = work.then((s) => console.log(`[carton-labels] ${body.job}: ${s}`)).catch((e) => console.error(`[carton-labels] ${body.job} failed: ${scrub(e instanceof Error ? e.message : e)}`));
    // Answer now; the work carries on in the background.
    const edge = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (edge?.waitUntil) edge.waitUntil(logged);
    else await logged;
    return json({ ok: true, accepted: true }, 202);
  } catch (error) {
    console.error("carton-labels failed:", scrub(error instanceof Error ? error.message : error));
    return json({ ok: false, error: "failed to start" }, 500);
  }
});
