// Small pure helpers shared by the export builders. No React, no browser: easy to test.

/**
 * A lower-case ASCII slug for file names: accents are stripped, anything that is not a letter or
 * digit becomes "-", and the result is trimmed and cut to 60 characters. Falls back to `fallback`
 * when nothing is left (a name made only of symbols).
 */
export function slugify(text: string, fallback = ""): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // the accent marks left behind by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug === "" ? fallback : slug;
}

/** JSON with a two-space indent and a final newline, so the downloaded file reads well in an editor. */
export function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** "monster-stormhide-drake.json", or just "encounter.json" when the name has nothing to slug. */
export function exportFileName(prefix: string, name: string): string {
  const slug = slugify(name);
  return slug === "" ? `${prefix}.json` : `${prefix}-${slug}.json`;
}

/** Escapes the five characters that matter in HTML, so monster text can't break the markup it is put in. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A slug not yet in `used`: "mind-lash", then "mind-lash-2". The chosen slug is added to the set. */
export function uniqueSlug(text: string, used: Set<string>): string {
  const base = slugify(text, "item");
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

/** A well-known fast text hash (cyrb53) giving a 53-bit number. Not secure, just well spread. */
function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(value: number, length: number): string {
  let rest = value;
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE62[rest % 62];
    rest = Math.floor(rest / 62);
  }
  return out;
}

/**
 * A 16-character letters-and-digits id made from `seed`. The same seed always gives the same id, so
 * exporting the same monster twice gives identical files (Foundry wants ids of this shape for items).
 */
export function stableId(seed: string): string {
  return base62(cyrb53(seed, 0), 8) + base62(cyrb53(seed, 1), 8);
}
