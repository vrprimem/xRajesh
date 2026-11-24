import assert from "node:assert/strict";
import { test } from "node:test";
import { createLabelsClient, findArrivals, hasArrived, LabelsApiError, safeSvg, type LookedUp } from "./labels-api.ts";

type Call = { method: string; url: string; body: unknown; auth: string | undefined };

/** A stand-in for the inventory software: remembers every request and answers from a table. */
function fakeServer(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.Authorization });
    const hit = answers[`${method} ${url.replace("https://api.test/api", "")}`] ?? { status: 404, body: { detail: "not found" } };
    const status = hit.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(hit.body) };
  };
  return { calls, fetch };
}

const client = (server: ReturnType<typeof fakeServer>) => createLabelsClient({ username: "portal", password: "hunter2-secret", baseUrl: "https://api.test/api", fetch: server.fetch });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect x="0" y="0" width="2" height="5"/></svg>';

test("prints labels: logs in, asks for the product at the warehouse, returns serial and picture", async () => {
  const server = fakeServer({
    "POST /auth/login/": { body: { access: "tok-abc", refresh: "r" } },
    "POST /products/150-SCRATCH%20BOTTLE/carton-labels/": { body: { labels: [{ serial: "1010001071105027", svg: SVG, qtyPerCarton: 110 }, { serial: "1010001071105034", svg: SVG, qtyPerCarton: 110 }] } },
  });
  const api = client(server);
  await api.login();
  const labels = await api.print("150-SCRATCH BOTTLE", "1", 2, 110);
  assert.deepEqual(labels.map((l) => l.serial), ["1010001071105027", "1010001071105034"]);
  assert.equal(labels[0].svg, SVG);
  assert.deepEqual(server.calls[1].body, { warehouseId: 1, count: 2, qtyPerCarton: 110, is_prepacked: false });
  assert.equal(server.calls[1].auth, "Bearer tok-abc");
  assert.equal(server.calls.length, 2, "two requests in all: log in, print");
});

test("the carton weight goes with the labels, as the inventory software's own print button sends it", async () => {
  const server = fakeServer({
    "POST /auth/login/": { body: { access: "t" } },
    "POST /products/X/carton-labels/": { body: { labels: [{ serial: "1010000000000001", svg: SVG }] } },
  });
  const api = client(server);
  await api.login();
  await api.print("X", "1", 1, 24, 8.46);
  assert.deepEqual(server.calls[1].body, { warehouseId: 1, count: 1, qtyPerCarton: 24, is_prepacked: false, weight_per_carton: "8.46" });
  await api.print("X", "1", 1, 24);
  assert.equal((server.calls[2].body as Record<string, unknown>).weight_per_carton, undefined, "no weight, no field");
  await assert.rejects(api.print("X", "1", 1, 24, 0), /more than 0/);
  await assert.rejects(api.print("X", "1", 1, 24, Number.NaN), /more than 0/);
});

test("reads label states, as a plain list or as a page", async () => {
  const list = [{ serial: "1010001071105027", state: "printed" }, { serial: "1010001071107169", state: "outbound" }, { serial: 5, state: "x" }];
  for (const body of [list, { count: 3, results: list }]) {
    const server = fakeServer({ "POST /auth/login/": { body: { access: "t" } }, "GET /products/REMOVER-LINT/carton-labels/?warehouse_id=1": { body } });
    const api = client(server);
    await api.login();
    assert.deepEqual(await api.states("REMOVER-LINT", "1"), [{ serial: "1010001071105027", state: "printed" }, { serial: "1010001071107169", state: "outbound" }]);
  }
});

test("only ever sends the four allowed requests", async () => {
  const server = fakeServer({ "POST /auth/login/": { body: { access: "t" } } });
  const api = client(server);
  await api.login();
  // A product code cannot smuggle another address in: it is encoded into one path piece.
  await assert.rejects(api.states("X/../../barcodes/scan", "1"), /HTTP 404/);
  assert.match(server.calls[1].url, /\/products\/X%2F\.\.%2F\.\.%2Fbarcodes%2Fscan\/carton-labels\/\?warehouse_id=1$/);
  await assert.rejects(api.states("X", "1; drop"), /no number/);
  await assert.rejects(api.print("X", "1", 51, 10), /1 to 50/);
  await assert.rejects(api.print("X", "1", 0, 10), /1 to 50/);
  await assert.rejects(api.print("X", "1", 5, 0), /whole number/);
  // A label number is 16 digits and nothing else: no other address or extra query can ride along.
  for (const bad of ["101000076080882", "1010000760808823&x=1", "../scan/?b=1010000760808823", ""]) await assert.rejects(api.lookup(bad), /16 digits/);
  assert.equal(await api.lookup("1010000760808823"), null, "unknown to the inventory software (404)");
  const sent = server.calls.map((c) => `${c.method} ${c.url.replace("https://api.test/api", "").replace(/\/products\/[^/]+\//, "/products/{sku}/").replace(/\?b=\d{16}$/, "?b={serial}")}`);
  for (const s of sent) assert.ok(["POST /auth/login/", "POST /products/{sku}/carton-labels/", "GET /products/{sku}/carton-labels/?warehouse_id=1", "GET /barcodes/lookup/?b={serial}"].includes(s), s);
  assert.ok(sent.every((s) => !s.includes("POST /barcodes")), "never a scan");
});

test("looks up one label by its number: its state and warehouse", async () => {
  const serial = "1010000760808823";
  const server = fakeServer({
    "POST /auth/login/": { body: { access: "t" } },
    [`GET /barcodes/lookup/?b=${serial}`]: { body: { cartonLabel: { serial, state: "inbound", warehouseId: 1, qtyPerCarton: 80 }, product: { sku: "OLD-RAT" } } },
    "GET /barcodes/lookup/?b=1010000760800000": { body: { cartonLabel: null, product: { sku: "OLD-RAT" } } },
    "GET /barcodes/lookup/?b=1010000760800001": { body: { cartonLabel: { serial: "1010000760809999", state: "inbound" } } },
  });
  const api = client(server);
  await api.login();
  assert.deepEqual(await api.lookup(serial), { serial, state: "inbound", warehouseVid: "1" });
  assert.equal(server.calls[1].method, "GET");
  assert.equal(server.calls[1].body, undefined, "a read sends nothing");
  assert.equal(await api.lookup("1010000760800000"), null, "a product, not a carton label");
  assert.equal(await api.lookup("1010000760800001"), null, "a reply about another label");
});

// Old Rat: 60 labels, #119 to #178. The product's list holds only its newest 50 (#129 to #178).
const RAT = Array.from({ length: 60 }, (_, i) => `10100007608${String(10000 + i).slice(1)}`);

function fakeInventory(states: Map<string, string>, looked: Map<string, LookedUp | null | Error>) {
  const lookups: string[] = [];
  return {
    lookups,
    inventory: {
      states: async () => RAT.slice(10).map((serial) => ({ serial, state: states.get(serial) ?? "printed" })),
      lookup: async (serial: string) => {
        lookups.push(serial);
        if (!looked.has(serial)) return { serial, state: "printed", warehouseVid: "1" };
        const hit = looked.get(serial);
        if (hit instanceof Error) throw hit;
        return hit ?? null;
      },
    },
  };
}
const keep = <T,>(list: T[]) => list;

test("arrivals: cartons too old for the product's list of 50 are looked up one by one", async () => {
  const states = new Map(RAT.slice(10).map((s, i) => [s, i < 45 ? "inbound" : "printed"]));
  const looked = new Map<string, LookedUp | null | Error>([
    [RAT[0], { serial: RAT[0], state: "inbound", warehouseVid: "1" }],
    [RAT[1], { serial: RAT[1], state: "outbound", warehouseVid: null }],
    [RAT[2], { serial: RAT[2], state: "inbound", warehouseVid: "2" }],
    [RAT[3], null],
    [RAT[4], new LabelsApiError("timeout")],
    [RAT[5], { serial: RAT[5], state: "retired", warehouseVid: "1" }],
  ]);
  const { inventory, lookups } = fakeInventory(states, looked);
  const found = await findArrivals([{ warehouse_vid: "1", sku: "OLD-RAT", serials: RAT }], inventory, { order: keep });
  assert.deepEqual(lookups.sort(), RAT.slice(0, 10).sort(), "only the 10 not in the list, each once");
  assert.equal(found.arrived.length, 45 + 2, "45 from the list, 2 looked up");
  assert.ok(found.arrived.includes(RAT[0]) && found.arrived.includes(RAT[1]));
  assert.ok(!found.arrived.includes(RAT[2]), "scanned in at another warehouse");
  assert.deepEqual([found.lookedUp, found.unknown, found.otherWarehouse, found.failed, found.left], [10, 1, 1, 1, 0]);
});

test("arrivals: lookups stop at the limit and the rest wait for the next run", async () => {
  const { inventory, lookups } = fakeInventory(new Map(), new Map());
  const found = await findArrivals([{ warehouse_vid: "1", sku: "OLD-RAT", serials: RAT }], inventory, { maxLookups: 4, parallel: 2 });
  assert.equal(lookups.length, 4);
  assert.deepEqual([found.lookedUp, found.left, found.arrived.length], [4, 6, 0]);
  const none = await findArrivals([], inventory);
  assert.deepEqual(none, { arrived: [], lookedUp: 0, unknown: 0, otherWarehouse: 0, failed: 0, left: 0 });
});

test("a bad reply is an error, never a guess", async () => {
  const base = { "POST /auth/login/": { body: { access: "t" } } };
  let api = client(fakeServer({ ...base, "POST /products/X/carton-labels/": { body: { labels: [] } } }));
  await api.login();
  await assert.rejects(api.print("X", "1", 2, 10), /printed no labels/);
  api = client(fakeServer({ ...base, "POST /products/X/carton-labels/": { body: { labels: [{ serial: "C-1-2-3", svg: SVG }] } } }));
  await api.login();
  await assert.rejects(api.print("X", "1", 1, 10), /not 16 digits/);
  api = client(fakeServer({ ...base, "POST /products/X/carton-labels/": { body: { labels: [{ serial: "1010000000000001" }, { serial: "1010000000000002" }] } } }));
  await api.login();
  await assert.rejects(api.print("X", "1", 1, 10), /printed 2 labels/);
  api = client(fakeServer({ ...base, "POST /products/X/carton-labels/": { status: 403, body: { detail: "no" } } }));
  await api.login();
  await assert.rejects(api.print("X", "1", 1, 10), /may not be allowed to print labels/);
});

test("the password and the token never reach an error message", async () => {
  const wrong = client(fakeServer({ "POST /auth/login/": { status: 401, body: { detail: "bad hunter2-secret" } } }));
  await assert.rejects(wrong.login(), (e: unknown) => e instanceof LabelsApiError && /rejected the username or password/.test(e.message) && !e.message.includes("hunter2"));
  const api = client(fakeServer({ "POST /auth/login/": { body: { access: "tok-very-secret" } }, "GET /products/X/carton-labels/?warehouse_id=1": { status: 500, body: { detail: "boom tok-very-secret hunter2-secret" } } }));
  await api.login();
  await assert.rejects(api.states("X", "1"), (e: unknown) => e instanceof LabelsApiError && !e.message.includes("tok-very-secret") && !e.message.includes("hunter2"));
});

test("arrived means scanned in at the warehouse", () => {
  assert.equal(hasArrived("printed"), false);
  assert.equal(hasArrived(""), false);
  assert.equal(hasArrived("inbound"), true);
  assert.equal(hasArrived("outbound"), true, "already sent on to a customer: it did arrive");
  assert.equal(hasArrived("in_transit"), true);
  assert.equal(hasArrived("retired"), false);
  assert.equal(hasArrived("VOID"), false);
});

test("only a plain barcode picture is kept", () => {
  assert.equal(safeSvg(SVG), SVG);
  assert.equal(safeSvg('<svg><script>alert(1)</script></svg>'), null);
  assert.equal(safeSvg('<svg onload="x()"><rect/></svg>'), null);
  assert.equal(safeSvg('<svg><a href="https://x">y</a></svg>'), null);
  assert.equal(safeSvg('<svg><image xlink:href="x"/></svg>'), null);
  assert.equal(safeSvg("<div>no</div>"), null);
  assert.equal(safeSvg(42), null);
  assert.equal(safeSvg("<svg>" + "x".repeat(20001) + "</svg>"), null);
});
