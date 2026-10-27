// The whole character is described by this one plain object. The mesh builder
// reads it, the sliders write it, and presets and saved files are just copies of it.

export type NumericKey =
  | "height"
  | "bulk"
  | "headSize"
  | "jaw"
  | "hoodDepth"
  | "horns"
  | "cloakLength"
  | "armLength"
  | "pauldrons";

export interface Params extends Record<NumericKey, number> {
  skin: string;
  cloth: string;
  eyes: string;
}

export interface NumericDef {
  key: NumericKey;
  label: string;
  group: "Body" | "Head" | "Garb";
  min: number;
  max: number;
  step: number;
  default: number;
}

export const NUMERIC_DEFS: NumericDef[] = [
  { key: "height", label: "Height", group: "Body", min: 0.8, max: 1.2, step: 0.01, default: 1 },
  { key: "bulk", label: "Bulk", group: "Body", min: 0.7, max: 1.5, step: 0.01, default: 1 },
  { key: "armLength", label: "Arm length", group: "Body", min: 0.8, max: 1.3, step: 0.01, default: 1 },
  { key: "headSize", label: "Head size", group: "Head", min: 0.8, max: 1.3, step: 0.01, default: 1 },
  { key: "jaw", label: "Jaw", group: "Head", min: 0.6, max: 1.5, step: 0.01, default: 1 },
  { key: "horns", label: "Horns", group: "Head", min: 0, max: 1, step: 0.01, default: 0.3 },
  { key: "hoodDepth", label: "Hood depth", group: "Garb", min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: "cloakLength", label: "Cloak length", group: "Garb", min: 0.3, max: 1, step: 0.01, default: 0.8 },
  { key: "pauldrons", label: "Pauldrons", group: "Garb", min: 0, max: 1, step: 0.01, default: 0.4 },
];

export interface Swatch {
  name: string;
  value: string;
}

export const SKIN_TONES: Swatch[] = [
  { name: "Grave pallor", value: "#8d8676" },
  { name: "Rot green", value: "#5f7a4c" },
  { name: "Ash", value: "#7a7a84" },
  { name: "Burnt umber", value: "#4a3326" },
  { name: "Flayed", value: "#9a5a48" },
];

export const CLOTH_COLORS: Swatch[] = [
  { name: "Dried blood", value: "#5a2218" },
  { name: "Soot", value: "#1e1e22" },
  { name: "Moss", value: "#2f3a24" },
  { name: "Bruise", value: "#3b2a4a" },
  { name: "Tallow", value: "#6a5a3c" },
];

export const EYE_COLORS: Swatch[] = [
  { name: "Ember", value: "#ff3a1c" },
  { name: "Amber", value: "#ffb020" },
  { name: "Wisp", value: "#40ff70" },
  { name: "Frost", value: "#c8d0ff" },
];

export function defaultParams(): Params {
  const params = {
    skin: SKIN_TONES[0].value,
    cloth: CLOTH_COLORS[0].value,
    eyes: EYE_COLORS[0].value,
  } as Params;
  for (const def of NUMERIC_DEFS) params[def.key] = def.default;
  return params;
}

export function clampParams(params: Params): Params {
  const out = { ...params };
  for (const def of NUMERIC_DEFS) {
    out[def.key] = Math.min(def.max, Math.max(def.min, params[def.key]));
  }
  return out;
}

// rng is injectable so tests can pass a seeded generator and get repeatable results.
export function randomParams(rng: () => number = Math.random): Params {
  const pick = (list: Swatch[]) => list[Math.floor(rng() * list.length)].value;
  const params = {
    skin: pick(SKIN_TONES),
    cloth: pick(CLOTH_COLORS),
    eyes: pick(EYE_COLORS),
  } as Params;
  for (const def of NUMERIC_DEFS) {
    const raw = def.min + rng() * (def.max - def.min);
    params[def.key] = Math.round(raw / def.step) * def.step;
  }
  return clampParams(params);
}
