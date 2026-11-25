// Content: the entries from loaded packs, as the core sees them. What fields an entry has beyond id and name
// is up to the system module; the pack file format itself is designed in Milestone 1, step 4.

/** "pack:entry", e.g. "srd-5.1:some-entry". */
export type ContentRef = string;

export function contentRef(pack: string, entry: string): ContentRef {
  return `${pack}:${entry}`;
}

/** Splits "pack:entry" at its first colon. Returns null for anything that is not a reference. */
export function parseContentRef(ref: string): { pack: string; entry: string } | null {
  const at = ref.indexOf(":");
  if (at <= 0 || at === ref.length - 1) return null;
  return { pack: ref.slice(0, at), entry: ref.slice(at + 1) };
}

export interface ContentEntry {
  id: string;
  name: string;
  [field: string]: unknown;
}

/**
 * Read-only lookup over every loaded pack, grouped into collections (the system decides their names).
 * A reference is unique only within its collection: a pack may have an entry "x" in two collections.
 */
export interface ContentIndex {
  get(collection: string, ref: ContentRef): (ContentEntry & { ref: ContentRef; pack: string }) | undefined;
  list(collection: string): (ContentEntry & { ref: ContentRef; pack: string })[];
  /** Packs present, as id and version, with the credit each asks for. */
  packs(): { id: string; version: string; attribution?: string }[];
}

export interface IndexedPack {
  id: string;
  version: string;
  collections: Record<string, ContentEntry[]>;
  /** The credit the pack's content asks for, if any. */
  attribution?: string;
}

const key = (collection: string, ref: ContentRef) => `${collection}\u0000${ref}`;

/** Builds a ContentIndex from packs already read and checked. */
export function createContentIndex(packs: IndexedPack[]): ContentIndex {
  const byRef = new Map<ContentRef, ContentEntry & { ref: ContentRef; pack: string }>();
  const byCollection = new Map<string, (ContentEntry & { ref: ContentRef; pack: string })[]>();
  for (const pack of packs) {
    for (const [collection, entries] of Object.entries(pack.collections)) {
      const list = byCollection.get(collection) ?? [];
      for (const entry of entries) {
        const indexed = { ...entry, ref: contentRef(pack.id, entry.id), pack: pack.id };
        byRef.set(key(collection, indexed.ref), indexed);
        list.push(indexed);
      }
      byCollection.set(collection, list);
    }
  }
  return {
    get: (collection, ref) => byRef.get(key(collection, ref)),
    list: (collection) => byCollection.get(collection) ?? [],
    packs: () => packs.map((p) => ({ id: p.id, version: p.version, ...(p.attribution ? { attribution: p.attribution } : {}) })),
  };
}
