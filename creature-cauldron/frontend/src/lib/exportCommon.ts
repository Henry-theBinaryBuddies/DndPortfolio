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
