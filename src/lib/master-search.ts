// Searching VRPRIME master SKUs by name, the way the database does it (public.master_sku_search in
// supabase/migrations/20261123110000_master_sku_search.sql): lower case, up to 6 words of the first 60 characters, at
// least 2 letters in all; every word must appear in the name or code, as plain text; names starting with the first word
// come first, then codes starting with it, then shorter names. The app asks the database; this copy decides when a
// search is worth sending, and serves the dev preview's sample list.

export type MasterSku = { code: string; name: string | null };

export function searchWords(query: string): string[] {
  return query.trim().slice(0, 60).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** True once enough has been typed to search (2 letters). */
export function canSearch(query: string): boolean {
  return searchWords(query).join("").length >= 2;
}

/** The database's search over a list held in memory, at most 25 matches. */
export function searchMasters(list: { code: string; name: string }[], query: string): { code: string; name: string }[] {
  const words = searchWords(query);
  if (words.join("").length < 2) return [];
  const first = words[0];
  return list
    .filter((m) => {
      const text = `${m.name} ${m.code}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => {
      const rank = (m: { code: string; name: string }) => (m.name.toLowerCase().startsWith(first) ? 0 : 2) + (m.code.toLowerCase().startsWith(first) ? 0 : 1);
      return rank(a) - rank(b) || a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    })
    .slice(0, 25);
}
