import { defaultPaint, paintKind, type Paint } from "./paint";
import { BEARD_STYLES, BODIES, CLOAKS, FAMILIES, HAIR_STYLES, HORN_STYLES, NUMERIC_DEFS, OUTFITS, RACES, clampParams, defaultParams, type Params } from "./params";

// The character as an editable file: its sculpt (Params) and its paint, so a design can be kept and opened again
// later (an STL or a token picture cannot be edited). A plain JSON document with a format name and a version, so a
// later version of the app can read an older file and say plainly when a file is not one of these.

export const CHARACTER_FORMAT = "effigy-character";
export const CHARACTER_VERSION = 1;

export interface Character {
  params: Params;
  paint: Paint;
}

export function characterFile(character: Character): string {
  return JSON.stringify({ format: CHARACTER_FORMAT, version: CHARACTER_VERSION, params: character.params, paint: character.paint }, null, 2);
}

// Reads a character file. Anything missing is filled from the defaults, numbers are kept inside their sliders'
// ranges, and a name the app does not know (a race, a style) is an error rather than a guess.
export function readCharacter(text: string): Character {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("this is not a character file (it is not JSON)");
  }
  const file = data as { format?: unknown; version?: unknown; params?: Record<string, unknown>; paint?: Record<string, unknown> };
  if (!file || typeof file !== "object" || file.format !== CHARACTER_FORMAT) throw new Error("this is not an Effigy Engine character file");
  if (typeof file.version !== "number" || file.version > CHARACTER_VERSION) throw new Error(`this character file is from a newer version of Effigy Engine (version ${String(file.version)})`);
  const given = file.params ?? {};

  const params = defaultParams();
  const pick = <T extends string>(key: string, names: readonly T[]): T | undefined => {
    const value = given[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !names.includes(value as T)) throw new Error(`the character file has an unknown ${key}: ${String(value)}`);
    return value as T;
  };
  // (a file from before there were families is a humanoid)
  params.family = pick("family", FAMILIES) ?? params.family;
  params.race = pick("race", RACES) ?? params.race;
  params.body = pick("body", BODIES) ?? params.body;
  params.hornStyle = pick("hornStyle", HORN_STYLES) ?? params.hornStyle;
  params.hairStyle = pick("hairStyle", HAIR_STYLES) ?? params.hairStyle;
  params.beardStyle = pick("beardStyle", BEARD_STYLES) ?? params.beardStyle;
  // (a file from before there was clothing wears none)
  params.outfit = pick("outfit", OUTFITS) ?? params.outfit;
  params.cloak = pick("cloak", CLOAKS) ?? params.cloak;
  for (const d of NUMERIC_DEFS) {
    const value = given[d.key];
    if (typeof value === "number" && Number.isFinite(value)) params[d.key] = value;
  }

  const paint = defaultPaint(paintKind(params));
  const colours = file.paint ?? {};
  for (const key of ["skin", "eyes", "hair", "horns", "teeth", "cloth", "leather", "cloak", "metal"] as const) {
    const value = colours[key];
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) paint[key] = value.toLowerCase();
  }
  if (typeof colours.eyeGlow === "boolean") paint.eyeGlow = colours.eyeGlow;
  if (typeof colours.grime === "number" && Number.isFinite(colours.grime)) paint.grime = Math.min(1, Math.max(0, colours.grime));
  return { params: clampParams(params), paint };
}

// Undo and redo over whole characters. Edits are recorded as they settle (see main.ts), so a slider dragged
// across its range is one step, not one for each value it passed.
export class History {
  private past: Character[] = [];
  private future: Character[] = [];
  constructor(private present: Character) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  // A new state: the one before it can be gone back to, and whatever had been undone is dropped
  record(next: Character): void {
    if (sameCharacter(next, this.present)) return;
    this.past.push(this.present);
    if (this.past.length > 200) this.past.shift();
    this.present = next;
    this.future = [];
  }

  undo(): Character | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(this.present);
    this.present = previous;
    return previous;
  }

  redo(): Character | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }
}

export function sameCharacter(a: Character, b: Character): boolean {
  return JSON.stringify(a.params) === JSON.stringify(b.params) && JSON.stringify(a.paint) === JSON.stringify(b.paint);
}
