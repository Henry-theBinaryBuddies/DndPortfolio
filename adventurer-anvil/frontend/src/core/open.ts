// Opening a character file someone hands the app (a download, a file from a friend, an old save): check it is one,
// that this app can read it, that it is for this system; bring an older one up to date; and say which of its packs
// are missing or a different version. Nothing here touches storage.
import { CHARACTER_FORMAT, CHARACTER_FORMAT_VERSION, type CharacterDocument } from "./character";
import type { PackRef } from "./character";
import type { SystemModule } from "./system";

export type OpenResult =
  | { ok: true; doc: CharacterDocument; notes: string[] }
  | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";

/** Reads text from a file, then the character in it. */
export function readCharacterText(text: string, system: SystemModule, loaded: PackRef[]): OpenResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't readable: it isn't JSON." };
  }
  return readCharacter(data, system, loaded);
}

export function readCharacter(data: unknown, system: SystemModule, loaded: PackRef[]): OpenResult {
  const notOne = { ok: false as const, error: "This isn't an Adventurer Anvil character file." };
  if (!isObject(data) || data.format !== CHARACTER_FORMAT) return notOne;
  if (typeof data.formatVersion !== "number") return notOne;
  if (data.formatVersion > CHARACTER_FORMAT_VERSION) {
    return { ok: false, error: "This character was saved by a newer version of Adventurer Anvil. Update the app to open it." };
  }

  const sys = data.system;
  if (!isObject(sys) || !isText(sys.id) || typeof sys.version !== "number") return notOne;
  if (sys.id !== system.id) return { ok: false, error: `This character is for another game ("${sys.id}"), not ${system.title}.` };
  if (sys.version > system.version) {
    return { ok: false, error: `This character was saved with newer ${system.title} rules. Update the app to open it.` };
  }

  // The rest of the shape: anything wrong here means a damaged file, so it is refused rather than half-read.
  const fine =
    isText(data.id) && data.id.length > 0 &&
    isText(data.name) &&
    Array.isArray(data.packs) && data.packs.every((p) => isObject(p) && isText(p.id) && isText(p.version)) &&
    isObject(data.choices) &&
    Array.isArray(data.overrides) && data.overrides.every((o) => isObject(o) && isText(o.issueId) && isText(o.note) && isText(o.at)) &&
    Array.isArray(data.rolls) && data.rolls.every((r) => isObject(r) && isText(r.id) && typeof r.total === "number") &&
    isText(data.createdAt) && isText(data.updatedAt);
  if (!fine) return { ok: false, error: "This character file is damaged: some of its parts are missing or the wrong kind." };

  const raw = { ...(data as unknown as CharacterDocument), state: isObject(data.state) ? data.state : {} };
  const doc = raw.system.version < system.version ? system.migrate(raw) : raw;

  const notes: string[] = [];
  for (const used of doc.packs) {
    const have = loaded.find((p) => p.id === used.id);
    if (!have) notes.push(`Made with the pack "${used.id}" ${used.version}, which isn't loaded. Choices from it won't show.`);
    else if (have.version !== used.version) notes.push(`Made with the pack "${used.id}" ${used.version}; ${have.version} is loaded. Check that its choices still look right.`);
  }
  return { ok: true, doc, notes };
}
