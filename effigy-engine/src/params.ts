// The whole bust is described by this one plain object. The mesh builder
// reads it, the sliders write it, and presets and saved files are just copies of it.

export type NumericKey =
  | "headWidth"
  | "headHeight"
  | "brow"
  | "earSize"
  | "eyeSize"
  | "eyeSpacing"
  | "socketDepth"
  | "lids"
  | "cheekbones"
  | "gaunt"
  | "noseLength"
  | "noseWidth"
  | "snout"
  | "mouthWidth"
  | "jawWidth"
  | "chin"
  | "tusks"
  | "age"
  | "scars"
  | "stitches"
  | "grime"
  | "scales"
  | "eyebrows"
  | "hair"
  | "beard"
  | "horns"
  | "hoodDepth"
  | "pauldrons"
  | "bulk";

export const RACES = ["human", "elf", "half-elf", "dwarf", "halfling", "gnome", "half-orc", "tiefling", "dragonborn"] as const;
export type Race = (typeof RACES)[number];

export const BODIES = ["masculine", "neutral", "feminine"] as const;
export type Body = (typeof BODIES)[number];

export interface Params extends Record<NumericKey, number> {
  race: Race;
  body: Body;
  hood: boolean;
  skin: string;
  cloth: string;
  eyes: string;
  hairColor: string;
}

export type Group = "Skull" | "Eyes" | "Nose and cheeks" | "Mouth and jaw" | "Skin" | "Hair and brow" | "Crown and garb";

export interface NumericDef {
  key: NumericKey;
  label: string;
  group: Group;
  min: number;
  max: number;
  step: number;
  default: number;
}

const def = (key: NumericKey, label: string, group: Group, min: number, max: number, defaultValue: number): NumericDef => ({
  key,
  label,
  group,
  min,
  max,
  step: 0.01,
  default: defaultValue,
});

export const NUMERIC_DEFS: NumericDef[] = [
  def("headWidth", "Skull width", "Skull", 0.85, 1.2, 1),
  def("headHeight", "Skull height", "Skull", 0.85, 1.2, 1),
  def("brow", "Brow ridge", "Skull", 0, 1, 0.5),
  def("earSize", "Ears", "Skull", 0, 1, 0.35),
  def("eyeSize", "Eye size", "Eyes", 0.6, 1.5, 1),
  def("eyeSpacing", "Eye spacing", "Eyes", 0.8, 1.3, 1),
  def("socketDepth", "Socket depth", "Eyes", 0, 1, 0.6),
  def("lids", "Heavy lids", "Eyes", 0, 1, 0.4),
  def("cheekbones", "Cheekbones", "Nose and cheeks", 0, 1, 0.5),
  def("gaunt", "Gauntness", "Nose and cheeks", 0, 1, 0.5),
  def("noseLength", "Nose length", "Nose and cheeks", 0, 1, 0.4),
  def("noseWidth", "Nose width", "Nose and cheeks", 0.6, 1.5, 1),
  def("snout", "Snout", "Nose and cheeks", 0, 1, 0),
  def("mouthWidth", "Mouth width", "Mouth and jaw", 0.6, 1.4, 1),
  def("jawWidth", "Jaw width", "Mouth and jaw", 0.7, 1.3, 1),
  def("chin", "Chin", "Mouth and jaw", 0, 1, 0.4),
  def("tusks", "Tusks", "Mouth and jaw", 0, 1, 0),
  def("age", "Age", "Skin", 0, 1, 0.25),
  def("scars", "Scars", "Skin", 0, 1, 0.55),
  def("stitches", "Stitches", "Skin", 0, 1, 0.6),
  def("grime", "Grime", "Skin", 0, 1, 0.45),
  def("scales", "Scales", "Skin", 0, 1, 0),
  def("eyebrows", "Eyebrows", "Hair and brow", 0, 1, 0.45),
  def("hair", "Hair", "Hair and brow", 0, 1, 0),
  def("beard", "Beard", "Hair and brow", 0, 1, 0),
  def("horns", "Horns", "Crown and garb", 0, 1, 0),
  def("hoodDepth", "Hood depth", "Crown and garb", 0, 1, 0.5),
  def("pauldrons", "Pauldrons", "Crown and garb", 0, 1, 0.5),
  def("bulk", "Shoulder width", "Crown and garb", 0.7, 1.4, 1),
];

export interface Swatch {
  name: string;
  value: string;
}

export const SKIN_TONES: Swatch[] = [
  { name: "Elven pale", value: "#c4baa8" },
  { name: "Pale", value: "#c9b8a4" },
  { name: "Tan", value: "#a8825e" },
  { name: "Ruddy", value: "#b07a5a" },
  { name: "Dark brown", value: "#5e3d2b" },
  { name: "Grave pallor", value: "#8d8676" },
  { name: "Ash", value: "#7a7a84" },
  { name: "Burnt umber", value: "#4a3326" },
  { name: "Flayed", value: "#9a5a48" },
  { name: "Rot green", value: "#5f7a4c" },
  { name: "Orc grey-green", value: "#6d7a5a" },
  { name: "Infernal red", value: "#8a3a34" },
  { name: "Infernal violet", value: "#5a3a63" },
  { name: "Bronze scale", value: "#8a6a34" },
  { name: "Blue-grey", value: "#5c6f80" },
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

export const HAIR_COLORS: Swatch[] = [
  { name: "Coal", value: "#17130f" },
  { name: "Chestnut", value: "#4a2f1d" },
  { name: "Rust", value: "#7a3418" },
  { name: "Dust", value: "#8a7a55" },
  { name: "Ash", value: "#8c8c8a" },
  { name: "Bone", value: "#d6ccb6" },
];

const skin = (name: string) => SKIN_TONES.find((s) => s.name === name)!.value;
const cloth = (name: string) => CLOTH_COLORS.find((s) => s.name === name)!.value;
const eyes = (name: string) => EYE_COLORS.find((s) => s.name === name)!.value;
const hairColor = (name: string) => HAIR_COLORS.find((s) => s.name === name)!.value;

type Values = Partial<Record<NumericKey, number>>;

export interface RaceInfo {
  label: string;
  skin: string;
  values: Values;
}

// Picking a race resets every slider to its baseline and then applies these changes.
export const RACE_INFO: Record<Race, RaceInfo> = {
  human: { label: "Human", skin: skin("Tan"), values: {} },
  elf: {
    label: "Elf",
    skin: skin("Elven pale"),
    values: { headWidth: 0.92, headHeight: 1.06, cheekbones: 0.8, earSize: 1, eyeSize: 1.12, eyeSpacing: 1.05, noseWidth: 0.85, noseLength: 0.35, jawWidth: 0.85, chin: 0.3, gaunt: 0.35, brow: 0.25, age: 0.1, bulk: 0.85 },
  },
  "half-elf": {
    label: "Half-elf",
    skin: skin("Pale"),
    values: { earSize: 0.6, cheekbones: 0.65, eyeSize: 1.05, jawWidth: 0.95, noseWidth: 0.95, gaunt: 0.35, brow: 0.35, age: 0.15 },
  },
  dwarf: {
    label: "Dwarf",
    skin: skin("Ruddy"),
    values: { headWidth: 1.13, headHeight: 0.95, brow: 0.85, noseWidth: 1.35, noseLength: 0.5, jawWidth: 1.2, chin: 0.6, earSize: 0.2, cheekbones: 0.6, gaunt: 0.1, eyebrows: 0.85, beard: 0.9, bulk: 1.3, age: 0.35 },
  },
  halfling: {
    label: "Halfling",
    skin: skin("Tan"),
    values: { headWidth: 1.05, headHeight: 0.95, eyeSize: 1.2, noseWidth: 0.9, noseLength: 0.25, chin: 0.25, earSize: 0.55, brow: 0.2, cheekbones: 0.6, gaunt: 0, jawWidth: 0.9, hair: 0.55, bulk: 0.85, age: 0.1 },
  },
  gnome: {
    label: "Gnome",
    skin: skin("Ruddy"),
    values: { headWidth: 1.05, eyeSize: 1.3, noseLength: 0.8, noseWidth: 1.2, earSize: 0.7, brow: 0.3, chin: 0.3, gaunt: 0.2, hair: 0.45, beard: 0.3, bulk: 0.8, age: 0.3 },
  },
  "half-orc": {
    label: "Half-orc",
    skin: skin("Orc grey-green"),
    values: { headWidth: 1.1, brow: 0.9, jawWidth: 1.25, chin: 0.85, tusks: 0.6, noseWidth: 1.2, noseLength: 0.3, cheekbones: 0.7, earSize: 0.4, mouthWidth: 1.15, bulk: 1.35, gaunt: 0.3, age: 0.3 },
  },
  tiefling: {
    label: "Tiefling",
    skin: skin("Infernal red"),
    values: { horns: 0.85, earSize: 0.6, cheekbones: 0.7, eyeSize: 1.1, noseWidth: 0.9, jawWidth: 0.95, chin: 0.5, gaunt: 0.45, brow: 0.4, age: 0.15 },
  },
  dragonborn: {
    label: "Dragonborn",
    skin: skin("Bronze scale"),
    values: { snout: 0.85, noseWidth: 1.2, noseLength: 0.2, mouthWidth: 1.4, jawWidth: 1.15, brow: 0.7, earSize: 0, horns: 0.55, scales: 0.9, eyeSpacing: 1.15, eyeSize: 0.95, headWidth: 1.05, bulk: 1.3, cheekbones: 0.3, gaunt: 0.1, age: 0.1 },
  },
};

export interface Preset {
  name: string;
  race: Race;
  body?: Body;
  hood: boolean;
  values: Values;
  skin?: string;
  cloth?: string;
  eyes?: string;
  hairColor?: string;
}

export const PRESETS: Preset[] = [
  {
    name: "Revenant",
    race: "human",
    hood: true,
    skin: skin("Ash"),
    cloth: cloth("Soot"),
    eyes: eyes("Frost"),
    values: { gaunt: 1, socketDepth: 1, cheekbones: 0.8, age: 0.7, scars: 0.75, stitches: 0.5, grime: 0.7, lids: 0.6, brow: 0.6, noseLength: 0.3, hoodDepth: 0.8, horns: 0, eyebrows: 0.1 },
  },
  {
    name: "Cultist",
    race: "human",
    body: "neutral",
    hood: true,
    skin: skin("Pale"),
    cloth: cloth("Bruise"),
    eyes: eyes("Ember"),
    values: { hoodDepth: 1, gaunt: 0.6, brow: 0.4, scars: 0.2, stitches: 0, grime: 0.5, age: 0.4, horns: 0, pauldrons: 0, bulk: 0.9, lids: 0.5 },
  },
  {
    name: "Ghoul",
    race: "human",
    hood: false,
    skin: skin("Rot green"),
    cloth: cloth("Moss"),
    eyes: eyes("Wisp"),
    values: { gaunt: 1, socketDepth: 0.9, eyeSize: 1.3, earSize: 0.8, noseLength: 0, noseWidth: 0.7, mouthWidth: 1.3, tusks: 0.7, chin: 0.1, age: 1, grime: 0.9, scars: 0.9, stitches: 0, lids: 0.1, eyebrows: 0, pauldrons: 0.2, horns: 0 },
  },
  {
    name: "Warlord",
    race: "half-orc",
    hood: false,
    skin: skin("Orc grey-green"),
    cloth: cloth("Soot"),
    eyes: eyes("Amber"),
    hairColor: hairColor("Coal"),
    values: { scars: 1, stitches: 0.8, pauldrons: 1, bulk: 1.4, hair: 0.25, tusks: 0.85, brow: 0.95, grime: 0.6, age: 0.4, horns: 0 },
  },
  {
    name: "Crone",
    race: "human",
    body: "feminine",
    hood: true,
    skin: skin("Pale"),
    cloth: cloth("Moss"),
    eyes: eyes("Wisp"),
    hairColor: hairColor("Ash"),
    values: { age: 1, noseLength: 1, noseWidth: 0.8, chin: 0.95, gaunt: 0.85, eyebrows: 1, scars: 0, stitches: 0, grime: 0.7, hoodDepth: 0.4, horns: 0, pauldrons: 0, bulk: 0.75, brow: 0.3 },
  },
  {
    name: "Infernal",
    race: "tiefling",
    body: "feminine",
    hood: false,
    skin: skin("Infernal violet"),
    cloth: cloth("Dried blood"),
    eyes: eyes("Amber"),
    hairColor: hairColor("Coal"),
    values: { horns: 1, hair: 0.75, scars: 0.3, stitches: 0, grime: 0.2, pauldrons: 0.8, age: 0.15, lids: 0.5 },
  },
  {
    name: "Slayer",
    race: "dwarf",
    hood: false,
    skin: skin("Ruddy"),
    cloth: cloth("Tallow"),
    eyes: eyes("Ember"),
    hairColor: hairColor("Rust"),
    values: { beard: 1, hair: 0.7, scars: 0.85, stitches: 0, brow: 1, pauldrons: 0.85, grime: 0.55, age: 0.5, eyebrows: 1, lids: 0.6 },
  },
];

export function defaultParams(): Params {
  const params = {
    race: "human" as Race,
    body: "masculine" as Body,
    hood: true,
    skin: RACE_INFO.human.skin,
    cloth: CLOTH_COLORS[0].value,
    eyes: EYE_COLORS[0].value,
    hairColor: HAIR_COLORS[1].value,
  } as Params;
  for (const d of NUMERIC_DEFS) params[d.key] = d.default;
  return params;
}

export function clampParams(params: Params): Params {
  const out = { ...params };
  for (const d of NUMERIC_DEFS) {
    out[d.key] = Math.min(d.max, Math.max(d.min, params[d.key]));
  }
  return out;
}

// Racial baseline: the sliders go back to defaults, then the race's own shape is applied.
// Clothing, eye colour, hair colour and the hood choice carry over, since they are personal taste.
export function applyRace(current: Params, race: Race): Params {
  const info = RACE_INFO[race];
  const next = defaultParams();
  next.race = race;
  next.body = current.body;
  next.skin = info.skin;
  next.cloth = current.cloth;
  next.eyes = current.eyes;
  next.hairColor = current.hairColor;
  next.hood = current.hood;
  Object.assign(next, info.values);
  return clampParams(next);
}

export function applyPreset(current: Params, preset: Preset): Params {
  const next = applyRace(current, preset.race);
  if (preset.body) next.body = preset.body;
  next.hood = preset.hood;
  if (preset.skin) next.skin = preset.skin;
  if (preset.cloth) next.cloth = preset.cloth;
  if (preset.eyes) next.eyes = preset.eyes;
  if (preset.hairColor) next.hairColor = preset.hairColor;
  Object.assign(next, preset.values);
  return clampParams(next);
}

// rng is injectable so tests can pass a seeded generator and get repeatable results.
export function randomParams(rng: () => number = Math.random): Params {
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const race = pick(RACES);
  const params = applyRace(defaultParams(), race);
  params.skin = pick(SKIN_TONES).value;
  params.cloth = pick(CLOTH_COLORS).value;
  params.eyes = pick(EYE_COLORS).value;
  params.hairColor = pick(HAIR_COLORS).value;
  params.body = pick(BODIES);
  params.hood = rng() < 0.6;
  for (const d of NUMERIC_DEFS) {
    const raw = d.min + rng() * (d.max - d.min);
    params[d.key] = Math.round(raw / d.step) * d.step;
  }
  // Keep the race readable: scales and snout stay off unless the race asked for them.
  if (race !== "dragonborn") {
    params.scales = 0;
    params.snout = 0;
  }
  return clampParams(params);
}
