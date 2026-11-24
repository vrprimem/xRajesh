// The only four things the portal ever asks the VRPRIME inventory software for carton labels:
//   POST /auth/login/                                   { username, password } -> { access }
//   POST /products/{sku}/carton-labels/                 print labels (what the software's own "print labels" button does)
//   GET  /products/{sku}/carton-labels/?warehouse_id=N  read a product's labels and their state (its newest 50 only)
//   GET  /barcodes/lookup/?b=<16 digits>                read one label and its state (what its Scan page checks first)
// Nothing else is possible from here: no scan, no inbound, no retire, no change to a product, a name, stock or a setting.
// `request` below refuses any other address before it is sent. Plain TypeScript (no Deno APIs) so `node --test` can run
// it with a fake server. The password and the token never appear in an error message.

export type PrintedLabel = { serial: string; svg: string | null; qtyPerCarton: number | null };
export type LabelState = { serial: string; state: string };
/** One label looked up by its number: its state, and the warehouse it belongs to when the reply says. */
export type LookedUp = { serial: string; state: string; warehouseVid: string | null };

type Fetch = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export const DEFAULT_BASE_URL = "https://api.vrprime.in/api";
/** The inventory software prints at most this many labels in one request. */
export const MAX_PER_REQUEST = 50;

/** A failure with a message safe to show and save (it never holds the password or a token). */
export class LabelsApiError extends Error {
  /** The HTTP status the inventory software answered with, when it answered. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/auth\/login\/$/ },
  { method: "POST", path: /^\/products\/[^/?#]+\/carton-labels\/$/ },
  { method: "GET", path: /^\/products\/[^/?#]+\/carton-labels\/\?warehouse_id=\d+$/ },
  { method: "GET", path: /^\/barcodes\/lookup\/\?b=\d{16}$/ },
];

/** A carton has arrived once the warehouse has scanned its label: any state after "printed", unless the label was thrown away. */
export function hasArrived(state: string): boolean {
  const s = state.trim().toLowerCase();
  if (!s || s === "printed") return false;
  return !/retir|void|cancel|delet|discard/.test(s);
}

/** Only a plain barcode picture is kept: anything that could run code is dropped (the label is then drawn by the portal). */
export function safeSvg(svg: unknown): string | null {
  if (typeof svg !== "string") return null;
  const s = svg.trim();
  if (s.length > 20000 || !/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return null;
  if (/<script|<foreignObject|<iframe|<image|<use|\son\w+\s*=|javascript:|href\s*=|url\(/i.test(s)) return null;
  return s;
}

export function createLabelsClient(options: { username: string; password: string; baseUrl?: string; fetch?: Fetch; timeoutMs?: number }) {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 25_000;
  let token: string | null = null;

  const scrub = (input: unknown): string => {
    let text = String(input ?? "");
    for (const secret of [options.password, token ?? ""]) if (secret && secret.length >= 4) text = text.split(secret).join("[redacted]");
    return text
      .replace(/Bearer\s+[^\s"'`,;)]+/gi, "[redacted]")
      .replace(/("?(?:access|refresh|token|password)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"')
      .slice(0, 300);
  };

  async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    if (!ALLOWED.some((a) => a.method === method && a.path.test(path))) throw new LabelsApiError("That request to the inventory software is not allowed");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (path !== "/auth/login/") headers.Authorization = `Bearer ${token}`;
    let reply;
    try {
      reply = await doFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new LabelsApiError(`Could not reach the inventory software (${scrub(error instanceof Error ? error.message : error)})`);
    }
    const text = await reply.text();
    if (!reply.ok) {
      if (reply.status === 401 || reply.status === 403) {
        throw new LabelsApiError(path === "/auth/login/" ? "The inventory software rejected the username or password" : `The inventory software refused the request (HTTP ${reply.status}): this login may not be allowed to print labels`, reply.status);
      }
      throw new LabelsApiError(`The inventory software answered HTTP ${reply.status}: ${scrub(text)}`, reply.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new LabelsApiError("The inventory software did not send JSON");
    }
  }

  const sku = (code: string) => encodeURIComponent(code);
  const warehouse = (vid: string): number => {
    if (!/^\d+$/.test(vid)) throw new LabelsApiError("The warehouse has no number in the inventory software");
    return Number(vid);
  };

  return {
    async login(): Promise<void> {
      const body = (await request("POST", "/auth/login/", { username: options.username, password: options.password })) as { access?: unknown };
      if (typeof body?.access !== "string" || !body.access) throw new LabelsApiError("The inventory software did not return a token");
      token = body.access;
    },

    /**
     * Prints `count` labels (1 to 50) for a product at a warehouse, with the carton weight in kg when there is one (the
     * label's "weight per carton"; the product's own weight is not touched). Exactly what was asked for must come back.
     */
    async print(code: string, warehouseVid: string, count: number, qtyPerCarton: number, weightKg: number | null = null): Promise<PrintedLabel[]> {
      if (!Number.isInteger(count) || count < 1 || count > MAX_PER_REQUEST) throw new LabelsApiError("Labels are printed 1 to 50 at a time");
      if (!Number.isInteger(qtyPerCarton) || qtyPerCarton < 1) throw new LabelsApiError("Pieces per carton must be a whole number from 1");
      if (weightKg !== null && !(Number.isFinite(weightKg) && weightKg > 0 && weightKg <= 1000)) throw new LabelsApiError("Carton weight must be more than 0 and at most 1000 kg");
      const body = (await request("POST", `/products/${sku(code)}/carton-labels/`, {
        warehouseId: warehouse(warehouseVid),
        count,
        qtyPerCarton,
        is_prepacked: false,
        ...(weightKg !== null ? { weight_per_carton: String(weightKg) } : {}),
      })) as { labels?: unknown };
      const list = Array.isArray(body?.labels) ? body.labels : [];
      const out: PrintedLabel[] = [];
      for (const item of list) {
        const l = item as { serial?: unknown; svg?: unknown; qtyPerCarton?: unknown };
        if (typeof l.serial !== "string" || !/^\d{16}$/.test(l.serial)) throw new LabelsApiError(`The inventory software sent a label number that is not 16 digits for ${code}`);
        out.push({ serial: l.serial, svg: safeSvg(l.svg), qtyPerCarton: typeof l.qtyPerCarton === "number" ? l.qtyPerCarton : null });
      }
      if (out.length === 0) throw new LabelsApiError(`The inventory software printed no labels for ${code}`);
      if (out.length > count) throw new LabelsApiError(`The inventory software printed ${out.length} labels for ${code} when ${count} were asked for`);
      return out;
    },

    /** A product's labels at a warehouse, with their state. The inventory software sends only the newest 50. */
    async states(code: string, warehouseVid: string): Promise<LabelState[]> {
      const body = await request("GET", `/products/${sku(code)}/carton-labels/?warehouse_id=${warehouse(warehouseVid)}`);
      const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results) ? (body as { results: unknown[] }).results : [];
      const out: LabelState[] = [];
      for (const item of list) {
        const l = item as { serial?: unknown; state?: unknown };
        if (typeof l.serial === "string" && typeof l.state === "string") out.push({ serial: l.serial, state: l.state });
      }
      return out;
    },

    /** One label by its number, read only. Null when the inventory software does not know it as a carton label. */
    async lookup(serial: string): Promise<LookedUp | null> {
      if (!/^\d{16}$/.test(serial)) throw new LabelsApiError("A label number is 16 digits");
      let body: unknown;
      try {
        body = await request("GET", `/barcodes/lookup/?b=${serial}`);
      } catch (error) {
        if (error instanceof LabelsApiError && error.status === 404) return null;
        throw error;
      }
      const reply = (body ?? {}) as { cartonLabel?: unknown; carton_label?: unknown };
      const label = (reply.cartonLabel ?? reply.carton_label) as { serial?: unknown; state?: unknown; warehouseId?: unknown; warehouse_id?: unknown } | null | undefined;
      if (!label || typeof label !== "object" || typeof label.state !== "string" || !label.state.trim()) return null;
      if (typeof label.serial === "string" && label.serial !== serial) return null;
      const w = label.warehouseId ?? label.warehouse_id;
      return { serial, state: label.state, warehouseVid: (typeof w === "number" && Number.isInteger(w)) || (typeof w === "string" && /^\d+$/.test(w)) ? String(Number(w)) : null };
    },
  };
}

export type Wait = { warehouse_vid: string; sku: string; serials: string[] };
type ReadsLabels = Pick<ReturnType<typeof createLabelsClient>, "states" | "lookup">;

/** At most this many labels are looked up one by one in a run; any more wait for the next run (every 30 minutes). */
export const MAX_LOOKUPS = 300;

/** The list in a random order, so labels left over from one run get their turn in the next. */
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which of the loaded cartons on their way the warehouse has scanned in. Each product's label list is read once, but it
 * holds only that product's newest 50 labels, so a carton not in it is looked up by its own number (read only), a few at
 * a time. A looked-up label counts only at the dispatch's warehouse, as the list does.
 */
export async function findArrivals(
  waits: Wait[],
  inventory: ReadsLabels,
  options: { maxLookups?: number; parallel?: number; order?: <T>(list: T[]) => T[] } = {},
): Promise<{ arrived: string[]; lookedUp: number; unknown: number; otherWarehouse: number; failed: number; left: number }> {
  const arrived: string[] = [];
  const older: { serial: string; warehouseVid: string }[] = [];
  for (const w of waits) {
    const states = new Map((await inventory.states(w.sku, w.warehouse_vid)).map((l) => [l.serial, l.state]));
    for (const serial of w.serials) {
      const state = states.get(serial);
      if (state === undefined) older.push({ serial, warehouseVid: w.warehouse_vid });
      else if (hasArrived(state)) arrived.push(serial);
    }
  }

  const todo = (options.order ?? shuffled)(older).slice(0, options.maxLookups ?? MAX_LOOKUPS);
  const tally = { unknown: 0, otherWarehouse: 0, failed: 0 };
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const o = todo[next++];
      try {
        const label = await inventory.lookup(o.serial);
        if (!label) tally.unknown += 1;
        else if (label.warehouseVid !== null && Number(label.warehouseVid) !== Number(o.warehouseVid)) tally.otherWarehouse += 1;
        else if (hasArrived(label.state)) arrived.push(o.serial);
      } catch {
        tally.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.parallel ?? 4, todo.length) }, worker));
  return { arrived, lookedUp: todo.length, ...tally, left: older.length - todo.length };
}
