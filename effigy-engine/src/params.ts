// The whole bust is described by this one plain object. The mesh builder
// reads it, the sliders write it, and presets and saved files are just copies of it.

export type NumericKey =
  | "headWidth"
  | "headHeight"
  | "brow"
  | "eyeSize"
  | "eyeSpacing"
  | "socketDepth"
  | "cheekbones"
  | "gaunt"
  | "noseLength"
  | "noseWidth"
  | "mouthWidth"
  | "jawWidth"
  | "chin"
  | "tusks"
  | "earSize"
  | "scars"
  | "grime"
  | "horns"
  | "hoodDepth"
  | "pauldrons"
  | "bulk";

export interface Params extends Record<NumericKey, number> {
  skin: string;
  cloth: string;
  eyes: string;
}

export type Group = "Skull" | "Eyes" | "Nose and cheeks" | "Mouth and jaw" | "Skin" | "Crown and garb";

export interface NumericDef {
  key: NumericKey;
  label: string;
  group: Group;
  min: number;
  max: number;
  step: number;
  default: number;
}

export const NUMERIC_DEFS: NumericDef[] = [
  { key: "headWidth", label: "Skull width", group: "Skull", min: 0.85, max: 1.2, step: 0.01, default: 1 },
  { key: "headHeight", label: "Skull height", group: "Skull", min: 0.85, max: 1.2, step: 0.01, default: 1 },
  { key: "brow", label: "Brow ridge", group: "Skull", min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: "earSize", label: "Ears", group: "Skull", min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: "eyeSize", label: "Eye size", group: "Eyes", min: 0.6, max: 1.5, step: 0.01, default: 1 },
  { key: "eyeSpacing", label: "Eye spacing", group: "Eyes", min: 0.8, max: 1.3, step: 0.01, default: 1 },
  { key: "socketDepth", label: "Socket depth", group: "Eyes", min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: "cheekbones", label: "Cheekbones", group: "Nose and cheeks", min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: "gaunt", label: "Gauntness", group: "Nose and cheeks", min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: "noseLength", label: "Nose length", group: "Nose and cheeks", min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: "noseWidth", label: "Nose width", group: "Nose and cheeks", min: 0.6, max: 1.5, step: 0.01, default: 1 },
  { key: "mouthWidth", label: "Mouth width", group: "Mouth and jaw", min: 0.6, max: 1.4, step: 0.01, default: 1 },
  { key: "jawWidth", label: "Jaw width", group: "Mouth and jaw", min: 0.7, max: 1.3, step: 0.01, default: 1 },
  { key: "chin", label: "Chin", group: "Mouth and jaw", min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: "tusks", label: "Tusks", group: "Mouth and jaw", min: 0, max: 1, step: 0.01, default: 0 },
  { key: "scars", label: "Scars", group: "Skin", min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: "grime", label: "Grime", group: "Skin", min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: "horns", label: "Horns", group: "Crown and garb", min: 0, max: 1, step: 0.01, default: 0.3 },
  { key: "hoodDepth", label: "Hood depth", group: "Crown and garb", min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: "pauldrons", label: "Pauldrons", group: "Crown and garb", min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: "bulk", label: "Shoulder width", group: "Crown and garb", min: 0.7, max: 1.4, step: 0.01, default: 1 },
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
