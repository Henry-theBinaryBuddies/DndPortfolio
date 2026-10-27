// The whole bust is described by this one plain object. The mesh builder
// reads it, the sliders write it, and presets and saved files are just copies of it.
//
// The sliders are deliberately few and anatomically bounded. The underlying skull, ears, eye
// spacing and nose and jaw baselines come from the race's skeleton (see RACE_SKELETON); the sliders
// then move a face within the range real faces vary. `derive` combines the two.

export type NumericKey =
  | "age"
  | "weight"
  | "muscle"
  | "brow"
  | "cheekbones"
  | "noseSize"
  | "lips"
  | "jaw"
  | "lids"
  | "eyebrows"
  | "horns"
  | "tusks"
  | "scars"
  | "stitches"
  | "grime"
  | "pauldrons";

export const RACES = ["human", "elf", "half-elf", "dwarf", "halfling", "gnome", "half-orc", "tiefling", "dragonborn"] as const;
export type Race = (typeof RACES)[number];

export const BODIES = ["masculine", "neutral", "feminine"] as const;
export type Body = (typeof BODIES)[number];

// "glow" is a single solid colour, "realistic" has a sclera, iris, pupil and cornea.
export const EYE_STYLES = ["glow", "realistic"] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];

export interface Params extends Record<NumericKey, number> {
  race: Race;
  body: Body;
  eyeStyle: EyeStyle;
  skin: string;
  cloth: string;
  eyes: string;
  hairColor: string;
}

export type Group = "Body" | "Face" | "Fantasy" | "Skin" | "Garb";

export interface NumericDef {
  key: NumericKey;
  label: string;
  group: Group;
  min: number;
  max: number;
  step: number;
  default: number;
}

const def = (key: NumericKey, label: string, group: Group, defaultValue: number): NumericDef => ({
  key,
  label,
  group,
  min: 0,
  max: 1,
  step: 0.01,
  default: defaultValue,
});

export const NUMERIC_DEFS: NumericDef[] = [
  def("age", "Age", "Body", 0.3),
  def("weight", "Weight", "Body", 0.5),
  def("muscle", "Muscle", "Body", 0.45),
  def("brow", "Brow ridge", "Face", 0.5),
  def("cheekbones", "Cheekbones", "Face", 0.5),
  def("noseSize", "Nose size", "Face", 0.5),
  def("lips", "Lips", "Face", 0.5),
  def("jaw", "Jaw", "Face", 0.5),
  def("lids", "Heavy lids", "Face", 0.4),
  def("eyebrows", "Eyebrows", "Face", 0.5),
  def("horns", "Horns", "Fantasy", 0),
  def("tusks", "Tusks", "Fantasy", 0),
  def("scars", "Scars", "Skin", 0),
  def("stitches", "Stitches", "Skin", 0),
  def("grime", "Grime", "Skin", 0.3),
  def("pauldrons", "Pauldrons", "Garb", 0.5),
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

// Natural irises first, then the unnatural glows
export const EYE_COLORS: Swatch[] = [
  { name: "Brown", value: "#5a3a1e" },
  { name: "Hazel", value: "#7a5a2a" },
  { name: "Green", value: "#4a7a4a" },
  { name: "Blue", value: "#3a6a9a" },
  { name: "Grey", value: "#7a8288" },
  { name: "Ember", value: "#ff3a1c" },
  { name: "Amber", value: "#ffb020" },
  { name: "Wisp", value: "#40ff70" },
  { name: "Frost", value: "#c8d0ff" },
];

// Colours the eyebrows for now; hair and beards come back later with physics
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

// A race's skeleton: the bone structure the sliders then adjust. Ratios are relative to a human
// (1.0). These stay inside the ranges real populations vary, plus the fantasy features (pointed ears,
// a muzzle, scales) that define a race. The "base" values are added to the matching slider, so a
// half-orc's brow is heavy even with the Brow ridge slider at its midpoint.
export interface Skeleton {
  headWidth: number; // skull breadth
  headHeight: number;
  earSize: number; // 0 none, ~0.3 human, 1 long and pointed
  noseLength: number; // 0..1 baseline
  noseWidth: number;
  noseBridge: number; // -1 flat .. +1 high and prominent
  mouthWidth: number;
  jaw: number; // jaw breadth
  chin: number; // 0..1 baseline projection
  prognathism: number; // how far the lower face juts forward
  slope: number; // forehead recession
  angularity: number; // 0 soft and rounded .. 1 hard planes and sharp edges (orbital rim, jawline, cheek planes)
  browBase: number;
  cheekBase: number;
  lipBase: number;
  snout: number;
  scales: number;
  socketDepth: number;
  gaunt: number;
  shoulders: number; // shoulder breadth
}

export interface RaceInfo {
  label: string;
  skin: string;
  skeleton: Skeleton;
  // Slider values this race starts with (horns for a tiefling, tusks for a half-orc)
  defaults: Values;
}

const HUMAN: Skeleton = {
  headWidth: 1,
  headHeight: 1,
  earSize: 0.3,
  noseLength: 0.4,
  noseWidth: 1,
  noseBridge: 0,
  mouthWidth: 1,
  jaw: 1,
  chin: 0.4,
  prognathism: 0,
  slope: 0,
  angularity: 0.35,
  browBase: 0,
  cheekBase: 0,
  lipBase: 0,
  snout: 0,
  scales: 0,
  socketDepth: 0.45,
  gaunt: 0.15,
  shoulders: 1,
};

export const RACE_INFO: Record<Race, RaceInfo> = {
  human: { label: "Human", skin: skin("Tan"), skeleton: HUMAN, defaults: {} },
  // Narrow, long face with high cheekbones, a fine straight nose, delicate lips and a light brow
  elf: {
    label: "Elf",
    skin: skin("Elven pale"),
    skeleton: { ...HUMAN, angularity: 0.45, headWidth: 0.93, headHeight: 1.04, earSize: 1, noseLength: 0.35, noseWidth: 0.86, noseBridge: 0.35, mouthWidth: 0.95, jaw: 0.86, chin: 0.3, browBase: -0.2, cheekBase: 0.25, lipBase: -0.1, gaunt: 0.25, socketDepth: 0.4, shoulders: 0.86 },
    defaults: { eyebrows: 0.4 },
  },
  "half-elf": {
    label: "Half-elf",
    skin: skin("Pale"),
    skeleton: { ...HUMAN, angularity: 0.4, headWidth: 0.97, headHeight: 1.02, earSize: 0.6, noseWidth: 0.95, noseBridge: 0.15, jaw: 0.94, browBase: -0.08, cheekBase: 0.12, gaunt: 0.2, shoulders: 0.94 },
    defaults: {},
  },
  // Broad head, heavy brow, wide strong nose, full cheeks, a thick jaw and chin, a thick neck
  dwarf: {
    label: "Dwarf",
    skin: skin("Ruddy"),
    skeleton: { ...HUMAN, angularity: 0.7, headWidth: 1.1, headHeight: 0.95, earSize: 0.25, noseLength: 0.5, noseWidth: 1.25, noseBridge: 0.3, jaw: 1.15, chin: 0.55, browBase: 0.3, cheekBase: 0.1, gaunt: 0, socketDepth: 0.5, shoulders: 1.25 },
    defaults: { eyebrows: 0.85, muscle: 0.7, weight: 0.6 },
  },
  // Round, soft face: full cheeks, a small button nose, a gentle brow
  halfling: {
    label: "Halfling",
    skin: skin("Tan"),
    skeleton: { ...HUMAN, angularity: 0.12, headWidth: 1.04, headHeight: 0.97, earSize: 0.5, noseLength: 0.2, noseWidth: 0.9, noseBridge: -0.2, jaw: 0.9, chin: 0.25, browBase: -0.15, cheekBase: 0.2, lipBase: 0.1, gaunt: 0, shoulders: 0.8 },
    defaults: { muscle: 0.3, weight: 0.58 },
  },
  // Big expressive nose, pointed ears, full cheeks and a small chin
  gnome: {
    label: "Gnome",
    skin: skin("Ruddy"),
    skeleton: { ...HUMAN, angularity: 0.3, headWidth: 1.03, headHeight: 0.98, earSize: 0.6, noseLength: 0.85, noseWidth: 1.15, noseBridge: 0.2, chin: 0.25, browBase: 0.05, cheekBase: 0.15, gaunt: 0.1, shoulders: 0.78 },
    defaults: { muscle: 0.3 },
  },
  // Sloped forehead, a very heavy brow, a broad flat nose, high cheekbones, and a heavy jutting jaw
  "half-orc": {
    label: "Half-orc",
    skin: skin("Orc grey-green"),
    skeleton: { ...HUMAN, angularity: 0.95, headWidth: 1.08, headHeight: 1, earSize: 0.4, noseLength: 0.3, noseWidth: 1.2, noseBridge: -0.3, mouthWidth: 1.12, jaw: 1.22, chin: 0.8, prognathism: 0.55, slope: 0.6, browBase: 0.4, cheekBase: 0.25, lipBase: -0.15, socketDepth: 0.55, shoulders: 1.3 },
    defaults: { tusks: 0.6, muscle: 0.75, lids: 0.65, eyebrows: 0.8 },
  },
  // Angular: sharp cheekbones, a defined jaw, an arched brow and slightly pointed ears
  tiefling: {
    label: "Tiefling",
    skin: skin("Infernal red"),
    skeleton: { ...HUMAN, angularity: 0.78, earSize: 0.55, noseWidth: 0.92, noseBridge: 0.2, jaw: 0.95, chin: 0.5, browBase: 0.15, cheekBase: 0.3, gaunt: 0.3, shoulders: 0.98 },
    defaults: { horns: 0.85 },
  },
  // A muzzle with a heavy brow ridge, a broad jaw and no ears
  dragonborn: {
    label: "Dragonborn",
    skin: skin("Bronze scale"),
    skeleton: { ...HUMAN, angularity: 0.85, headWidth: 1.05, earSize: 0, noseLength: 0.2, noseWidth: 1.2, noseBridge: -0.3, mouthWidth: 1.4, jaw: 1.15, slope: 0.4, browBase: 0.35, cheekBase: 0.1, snout: 0.85, scales: 0.9, gaunt: 0.05, shoulders: 1.3 },
    defaults: { horns: 0.55, muscle: 0.7, eyebrows: 0 },
  },
};

export interface Preset {
  name: string;
  race: Race;
  body?: Body;
  eyeStyle?: EyeStyle;
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
    eyeStyle: "glow",
    skin: skin("Ash"),
    cloth: cloth("Soot"),
    eyes: eyes("Frost"),
    values: { age: 0.7, weight: 0.08, muscle: 0.3, brow: 0.6, cheekbones: 0.8, lids: 0.6, scars: 0.75, stitches: 0.5, grime: 0.7, eyebrows: 0.1, noseSize: 0.35 },
  },
  {
    name: "Cultist",
    race: "human",
    body: "neutral",
    eyeStyle: "glow",
    skin: skin("Pale"),
    cloth: cloth("Bruise"),
    eyes: eyes("Ember"),
    values: { age: 0.4, weight: 0.35, muscle: 0.25, brow: 0.4, lids: 0.5, scars: 0.2, stitches: 0, grime: 0.5, pauldrons: 0 },
  },
  {
    name: "Ghoul",
    race: "human",
    eyeStyle: "glow",
    skin: skin("Rot green"),
    cloth: cloth("Moss"),
    eyes: eyes("Wisp"),
    values: { age: 1, weight: 0, muscle: 0.15, brow: 0.3, lips: 0.15, jaw: 0.2, noseSize: 0.1, tusks: 0.7, lids: 0.1, scars: 0.9, stitches: 0, grime: 0.9, eyebrows: 0, pauldrons: 0.2 },
  },
  {
    name: "Warlord",
    race: "half-orc",
    eyeStyle: "realistic",
    skin: skin("Orc grey-green"),
    cloth: cloth("Soot"),
    eyes: eyes("Amber"),
    hairColor: hairColor("Coal"),
    values: { age: 0.4, weight: 0.6, muscle: 0.9, brow: 0.95, scars: 1, stitches: 0.8, grime: 0.6, tusks: 0.85, pauldrons: 1 },
  },
  {
    name: "Crone",
    race: "human",
    body: "feminine",
    eyeStyle: "glow",
    skin: skin("Pale"),
    cloth: cloth("Moss"),
    eyes: eyes("Wisp"),
    hairColor: hairColor("Ash"),
    values: { age: 1, weight: 0.2, muscle: 0.05, brow: 0.3, noseSize: 1, jaw: 0.85, eyebrows: 1, scars: 0, stitches: 0, grime: 0.7, pauldrons: 0 },
  },
  {
    name: "Infernal",
    race: "tiefling",
    body: "feminine",
    eyeStyle: "glow",
    skin: skin("Infernal violet"),
    cloth: cloth("Dried blood"),
    eyes: eyes("Amber"),
    hairColor: hairColor("Coal"),
    values: { age: 0.2, horns: 1, lids: 0.5, scars: 0.3, stitches: 0, grime: 0.2, pauldrons: 0.8 },
  },
  {
    name: "Slayer",
    race: "dwarf",
    eyeStyle: "realistic",
    skin: skin("Ruddy"),
    cloth: cloth("Tallow"),
    eyes: eyes("Brown"),
    hairColor: hairColor("Rust"),
    values: { age: 0.5, muscle: 0.8, brow: 1, lids: 0.6, eyebrows: 1, scars: 0.85, stitches: 0, grime: 0.55, pauldrons: 0.85 },
  },
];

export function defaultParams(): Params {
  const params = {
    race: "human" as Race,
    body: "masculine" as Body,
    eyeStyle: "realistic" as EyeStyle,
    skin: RACE_INFO.human.skin,
    cloth: CLOTH_COLORS[0].value,
    eyes: eyes("Hazel"),
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

// 1 for masculine, 0 for feminine, halfway for neutral. Used to blend proportions.
export function masculinity(p: Params): number {
  return p.body === "masculine" ? 1 : p.body === "feminine" ? 0 : 0.5;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Everything the sculpt actually reads: the race's skeleton adjusted by the sliders, each kept
// inside a realistic range.
export interface Derived {
  headWidth: number;
  headHeight: number;
  earSize: number;
  socketDepth: number;
  noseLength: number;
  noseWidth: number;
  noseBridge: number;
  mouthWidth: number;
  jawWidth: number;
  chin: number;
  prognathism: number;
  slope: number;
  angularity: number;
  brow: number; // brow ridge: the slider plus the race's baseline
  cheek: number;
  snout: number;
  scales: number;
  gaunt: number; // sunken cheeks, from lean build and age
  fullness: number; // heavier cheeks and jowls, from weight
  lipFull: number;
  shoulders: number; // shoulder breadth before the masculine/feminine adjustment
  neckGirth: number;
}

export function derive(p: Params): Derived {
  const sk = RACE_INFO[p.race].skeleton;
  return {
    headWidth: sk.headWidth,
    headHeight: sk.headHeight,
    earSize: sk.earSize,
    socketDepth: clamp01(sk.socketDepth + 0.35 * p.age + 0.3 * (0.5 - p.weight) + 0.15 * (p.brow + sk.browBase - 0.5)),
    noseLength: clamp01(sk.noseLength + (p.noseSize - 0.5) * 0.5),
    noseWidth: sk.noseWidth * (0.86 + 0.28 * p.noseSize),
    noseBridge: sk.noseBridge,
    mouthWidth: sk.mouthWidth,
    jawWidth: sk.jaw * (0.93 + 0.14 * p.jaw),
    chin: clamp01(sk.chin + (p.jaw - 0.5) * 0.6),
    prognathism: sk.prognathism,
    slope: sk.slope,
    angularity: sk.angularity,
    brow: clamp01(p.brow + sk.browBase),
    cheek: clamp01(p.cheekbones + sk.cheekBase),
    snout: sk.snout,
    scales: sk.scales,
    gaunt: clamp01(sk.gaunt + 0.35 * p.age + 0.9 * (0.5 - p.weight)),
    fullness: clamp01((p.weight - 0.5) * 2),
    lipFull: 0.7 + 1.0 * clamp01(p.lips + sk.lipBase),
    shoulders: sk.shoulders * (0.9 + 0.28 * p.muscle + 0.14 * (p.weight - 0.5)),
    neckGirth: 1 + 0.25 * (p.muscle - 0.45) + 0.2 * (p.weight - 0.5),
  };
}

// Picking a race resets every slider to its starting point and applies the race's own defaults and
// skin. Build, clothing, eye style and colours, and hair colour carry over.
export function applyRace(current: Params, race: Race): Params {
  const info = RACE_INFO[race];
  const next = defaultParams();
  next.race = race;
  next.body = current.body;
  next.skin = info.skin;
  next.cloth = current.cloth;
  next.eyes = current.eyes;
  next.eyeStyle = current.eyeStyle;
  next.hairColor = current.hairColor;
  Object.assign(next, info.defaults);
  return clampParams(next);
}

export function applyPreset(current: Params, preset: Preset): Params {
  const next = applyRace(current, preset.race);
  if (preset.body) next.body = preset.body;
  if (preset.eyeStyle) next.eyeStyle = preset.eyeStyle;
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
  params.body = pick(BODIES);
  params.skin = pick(SKIN_TONES).value;
  params.cloth = pick(CLOTH_COLORS).value;
  params.eyes = pick(EYE_COLORS).value;
  params.hairColor = pick(HAIR_COLORS).value;
  // Fantasy features belong to the race, so only the anatomical sliders are randomized.
  const keep: NumericKey[] = ["horns", "tusks"];
  for (const d of NUMERIC_DEFS) {
    if (keep.includes(d.key)) continue;
    const raw = d.min + rng() * (d.max - d.min);
    params[d.key] = Math.round(raw / d.step) * d.step;
  }
  return clampParams(params);
}
