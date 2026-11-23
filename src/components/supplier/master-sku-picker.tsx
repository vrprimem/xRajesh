"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { SearchIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";
import { canSearch, searchMasters, type MasterSku } from "@/lib/master-search";
import { createClient } from "@/lib/supabase/client";

type State = "idle" | "short" | "searching" | "done" | "error";

/**
 * Picks a VRPRIME master SKU by its name: type part of it ("cleaner") and choose from the matches, with the arrow keys
 * and Enter or a tap. The master SKUs are the inventory software's products (copied in by the stock sync); the database
 * does the search. `demo` (the dev preview only) searches a fixed list instead.
 */
export function MasterSkuPicker({ id, value, onChange, demo }: { id: string; value: MasterSku | null; onChange: (m: MasterSku | null) => void; demo?: { code: string; name: string }[] }) {
  const [changing, setChanging] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ code: string; name: string }[]>([]);
  const [state, setState] = useState<State>("idle");
  const [active, setActive] = useState(-1);
  const listId = useId();
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async (q: string, mine: number) => {
    try {
      let rows: { code: string; name: string }[];
      if (demo) rows = searchMasters(demo, q);
      else {
        const { data, error } = await createClient().rpc("master_sku_search", { p_query: q });
        if (error) throw error;
        rows = (data ?? []) as { code: string; name: string }[];
      }
      if (mine !== seq.current) return;
      setResults(rows);
      setActive(rows.length ? 0 : -1);
      setState("done");
    } catch {
      if (mine !== seq.current) return;
      setResults([]);
      setState("error");
    }
  };

  const type = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    if (!q.trim()) {
      setResults([]);
      return setState("idle");
    }
    if (!canSearch(q)) {
      setResults([]);
      return setState("short");
    }
    setState("searching");
    timer.current = setTimeout(() => void run(q, mine), 250);
  };

  const pick = (m: { code: string; name: string }) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setQuery("");
    setResults([]);
    setState("idle");
    setChanging(false);
    onChange(m);
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      // Never submit the product form from here.
      e.preventDefault();
      if (active >= 0 && results[active]) pick(results[active]);
    } else if (e.key === "Escape") {
      setResults([]);
      setState("idle");
    }
  };

  if (value && !changing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border-2 border-frame bg-surface2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-semibold">{value.name ?? value.code}</p>
          {value.name ? <p className="break-all font-mono text-[13px] text-muted">{value.code}</p> : <p className="t-caption">Linked master SKU</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setChanging(true);
            setTimeout(() => input.current?.focus(), 0);
          }}
          className={buttonClass("row")}
        >
          Change
        </button>
      </div>
    );
  }

  const open = results.length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="input pl-10"
          placeholder="Type part of the name, e.g. cleaner"
          value={query}
          onChange={(e) => type(e.target.value)}
          onKeyDown={keys}
        />
      </div>
      <p className="t-caption" aria-live="polite">
        {state === "short"
          ? "Type at least 2 letters."
          : state === "searching"
            ? "Searching VRPRIME's products..."
            : state === "error"
              ? "Could not search. Check the connection and type again."
              : state === "done" && !open
                ? `No VRPRIME product has "${query.trim()}". Try another word.`
                : state === "done"
                  ? `${results.length === 25 ? "First 25" : results.length} ${results.length === 1 ? "match" : "matches"}. Tap one to pick it.`
                  : null}
      </p>
      {open ? (
        <ul id={listId} role="listbox" aria-label="VRPRIME products" className="max-h-80 overflow-auto rounded-[8px] border-2 border-frame bg-surface p-1">
          {results.map((m, i) => (
            <li
              key={m.code}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(m)}
              className={`cursor-pointer rounded-[6px] px-3 py-2.5 ${i === active ? "bg-accent-soft" : ""}`}
            >
              <span className="block font-semibold">{m.name}</span>
              <span className="block break-all font-mono text-[13px] text-muted">{m.code}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {value && changing ? (
        <div>
          <button
            type="button"
            onClick={() => {
              type("");
              setChanging(false);
            }}
            className={buttonClass("ghost", "!min-h-9 !px-2")}
          >
            Keep {value.name ?? value.code}
          </button>
        </div>
      ) : null}
    </div>
  );
}
