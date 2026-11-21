// Where saved characters live. The screens use only CharacterStore, so the browser storage used now (Milestone 1)
// can give way to an account's cloud storage (Milestone 2) without changing them; that is why every call returns
// a promise, though the browser's storage answers at once.
import type { CharacterBlurb, CharacterDocument } from "../core";

/** What a list of characters shows, kept apart from the files so the list never has to read them all. */
export interface CharacterSummary {
  id: string;
  name: string;
  /** e.g. "Hill Dwarf Cleric 1". */
  text: string;
  /** A small copy of the portrait (a data URL). */
  picture?: string;
  system: string;
  updatedAt: string;
}

export interface CharacterStore {
  /** Most recently edited first. */
  list(): Promise<CharacterSummary[]>;
  /** The file as stored, not yet checked: open it with readCharacter. Nothing if there is no such character. */
  load(id: string): Promise<unknown>;
  /** Saves the file and its summary. Throws StorageFullError when there is no room. */
  save(doc: CharacterDocument, blurb: CharacterBlurb): Promise<void>;
  remove(id: string): Promise<void>;
  /** Calls back when a character is saved or removed somewhere else (another tab); returns a function to stop. */
  watch(onChange: (id: string) => void): () => void;
}

export class StorageFullError extends Error {
  constructor() {
    super("There's no room left in this browser's storage.");
    this.name = "StorageFullError";
  }
}

const isFull = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);

/**
 * The browser's localStorage: one entry per character ("anvil:character:<id>") and an index of their summaries
 * ("anvil:characters"). If the index is ever lost or damaged it is rebuilt from the characters themselves.
 */
export class LocalStore implements CharacterStore {
  private readonly indexKey: string;
  private readonly prefix: string;

  constructor(private readonly storage: Storage, private readonly events?: Pick<Window, "addEventListener" | "removeEventListener">, namespace = "anvil") {
    this.indexKey = `${namespace}:characters`;
    this.prefix = `${namespace}:character:`;
  }

  async list(): Promise<CharacterSummary[]> {
    return [...this.readIndex()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<unknown> {
    const text = this.storage.getItem(this.prefix + id);
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text; // reading it will report the damage
    }
  }

  async save(doc: CharacterDocument, blurb: CharacterBlurb): Promise<void> {
    const key = this.prefix + doc.id;
    const before = this.storage.getItem(key);
    const summary: CharacterSummary = { id: doc.id, name: doc.name, text: blurb.text, system: doc.system.id, updatedAt: doc.updatedAt };
    if (blurb.picture) summary.picture = blurb.picture;
    const index = [...this.readIndex().filter((s) => s.id !== doc.id), summary];
    try {
      this.storage.setItem(key, JSON.stringify(doc));
      this.storage.setItem(this.indexKey, JSON.stringify(index));
    } catch (e) {
      // Leave things as they were: never a file without its summary, or the reverse.
      try {
        if (before === null) this.storage.removeItem(key);
        else this.storage.setItem(key, before);
      } catch { /* the old copy is the same size, so this only fails if storage itself is broken */ }
      throw isFull(e) ? new StorageFullError() : e;
    }
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(this.prefix + id);
    this.storage.setItem(this.indexKey, JSON.stringify(this.readIndex().filter((s) => s.id !== id)));
  }

  watch(onChange: (id: string) => void): () => void {
    if (!this.events) return () => {};
    const listener = (e: Event) => {
      const key = (e as StorageEvent).key;
      if (key?.startsWith(this.prefix)) onChange(key.slice(this.prefix.length));
    };
    this.events.addEventListener("storage", listener);
    return () => this.events!.removeEventListener("storage", listener);
  }

  private readIndex(): CharacterSummary[] {
    const text = this.storage.getItem(this.indexKey);
    if (text !== null) {
      try {
        const index: unknown = JSON.parse(text);
        if (Array.isArray(index) && index.every((s) => s && typeof s.id === "string" && typeof s.updatedAt === "string")) return index as CharacterSummary[];
      } catch { /* rebuilt below */ }
    }
    return this.rebuildIndex();
  }

  /** Summaries from the stored characters themselves: names and dates only, until each is next saved. */
  private rebuildIndex(): CharacterSummary[] {
    const found: CharacterSummary[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(this.prefix)) continue;
      try {
        const doc = JSON.parse(this.storage.getItem(key) ?? "") as Partial<CharacterDocument>;
        found.push({ id: key.slice(this.prefix.length), name: typeof doc.name === "string" ? doc.name : "", text: "", system: doc.system?.id ?? "", updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : "" });
      } catch {
        found.push({ id: key.slice(this.prefix.length), name: "", text: "", system: "", updatedAt: "" });
      }
    }
    return found;
  }
}

/** A Storage kept in memory: for tests, and the fallback when a browser refuses localStorage. */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  constructor(private readonly limit = Infinity) {}
  get length() { return this.items.size; }
  clear() { this.items.clear(); }
  getItem(key: string) { return this.items.get(key) ?? null; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  removeItem(key: string) { this.items.delete(key); }
  setItem(key: string, value: string) {
    const used = [...this.items].reduce((n, [k, v]) => n + (k === key ? 0 : k.length + v.length), 0);
    if (used + key.length + value.length > this.limit) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.items.set(key, value);
  }
}
