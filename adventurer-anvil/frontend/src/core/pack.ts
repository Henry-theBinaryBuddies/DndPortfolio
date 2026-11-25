// Content packs as the core sees them: a wrapper (any game) around collections only a system module understands.
// The core checks the wrapper and that a pack's requirements are loaded; the system checks the contents.
import type { ContentEntry, IndexedPack } from "./content";
import type { SystemModule } from "./system";

export const PACK_FORMAT = "adventurer-anvil-pack" as const;
export const PACK_FORMAT_VERSION = 1 as const;

export interface PackFile {
  /** Optional: points editors such as VS Code at the system's published JSON Schema. */
  $schema?: string;
  format: typeof PACK_FORMAT;
  formatVersion: typeof PACK_FORMAT_VERSION;
  id: string;
  version: string;
  /** The system module whose format the collections follow. */
  system: string;
  title: string;
  /** Credit shown in the page footer and in every export that uses the pack (required by open licences). */
  attribution?: string;
  /** Ids of other packs this one builds on; they must be loaded first. */
  requires: string[];
  collections: Record<string, ContentEntry[]>;
}

export type PackResult = { ok: true; pack: IndexedPack & { file: PackFile } } | { ok: false; errors: string[] };

/** Lower-case letters and digits, joined by single hyphens or dots, e.g. "srd-5.1" or "henry-phb". */
export const PACK_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Checks the wrapper only: the fields every pack has, whatever its game. */
export function checkPackWrapper(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["A pack must be a JSON object."];
  const p = data as Record<string, unknown>;
  const errors: string[] = [];
  if (p.format !== PACK_FORMAT) errors.push(`format: must be "${PACK_FORMAT}".`);
  if (p.formatVersion !== PACK_FORMAT_VERSION) errors.push(`formatVersion: must be ${PACK_FORMAT_VERSION}.`);
  if (typeof p.id !== "string" || !PACK_ID.test(p.id)) errors.push(`id: lower-case letters and digits joined by hyphens or dots, e.g. "my-pack".`);
  if (typeof p.version !== "string" || !/^\d+\.\d+\.\d+$/.test(p.version)) errors.push(`version: three numbers, e.g. "1.0.0".`);
  if (typeof p.system !== "string" || !p.system) errors.push("system: the id of the system this pack is for.");
  if (typeof p.title !== "string" || !p.title.trim()) errors.push("title: a name for the pack.");
  if (p.attribution !== undefined && typeof p.attribution !== "string") errors.push("attribution: text, if given.");
  if (!Array.isArray(p.requires) || p.requires.some((r) => typeof r !== "string")) errors.push("requires: a list of pack ids (may be empty).");
  if (!p.collections || typeof p.collections !== "object" || Array.isArray(p.collections)) {
    errors.push("collections: an object of named lists.");
  } else {
    for (const [name, list] of Object.entries(p.collections)) {
      if (!Array.isArray(list)) errors.push(`collections.${name}: must be a list.`);
    }
  }
  return errors;
}

/**
 * Reads a pack: the wrapper, then that its system is the one given and its required packs are among
 * those already loaded, then the system's own check of the contents (which may look into the loaded packs
 * to follow references).
 */
export function readPack(data: unknown, system: SystemModule, loaded: IndexedPack[]): PackResult {
  const wrapperErrors = checkPackWrapper(data);
  if (wrapperErrors.length) return { ok: false, errors: wrapperErrors };
  const file = data as PackFile;

  if (file.system !== system.id) {
    return { ok: false, errors: [`system: this pack is for "${file.system}", not "${system.id}".`] };
  }
  const missing = file.requires.filter((id) => !loaded.some((p) => p.id === id));
  if (missing.length) {
    return { ok: false, errors: missing.map((id) => `requires: the pack "${id}" must be loaded first.`) };
  }
  if (loaded.some((p) => p.id === file.id)) {
    return { ok: false, errors: [`id: a pack called "${file.id}" is already loaded.`] };
  }

  const required = loaded.filter((p) => file.requires.includes(p.id));
  const errors = system.packSchema.validate(file, required);
  if (errors.length) return { ok: false, errors };
  return { ok: true, pack: { id: file.id, version: file.version, collections: file.collections, ...(file.attribution ? { attribution: file.attribution } : {}), file } };
}
