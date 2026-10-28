// The whole bust is described by this one plain object. The mesh builder
// reads it, the sliders write it, and saved files are just copies of it.
//
// For now it describes the sculpt only, the form that prints: colour, paint and archetype presets were
// taken out (they are in git history) and come back once the sculpt is right.
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
  | "tusks";

export const RACES = ["human", "elf", "half-elf", "dwarf", "halfling", "gnome", "half-orc", "tiefling"] as const;
export type Race = (typeof RACES)[number];

export const BODIES = ["masculine", "neutral", "feminine"] as const;
export type Body = (typeof BODIES)[number];

// Horns are sculpted assets (see tools/export_horns.py); the Horn size slider scales whichever is chosen.
export const HORN_STYLES = ["none", "ram", "goat", "bull", "demon", "antelope", "stubby"] as const;
export type HornStyle = (typeof HORN_STYLES)[number];

// (Long hair is still rough, so no race starts with it; it is there to choose.)
export const HAIR_STYLES = ["none", "cropped", "swept", "mohawk", "long"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

// Beards are sculpted like the hair (see beard.ts)
export const BEARD_STYLES = ["none", "goatee", "short", "full"] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

export interface Params extends Record<NumericKey, number> {
  race: Race;
  body: Body;
  hornStyle: HornStyle;
  hairStyle: HairStyle;
  beardStyle: BeardStyle;
}

export type Group = "Body" | "Face" | "Fantasy";

export interface NumericDef {
  key: NumericKey;
  label: string;
  group: Group;
  min: number;
  max: number;
  step: number;
  default: number;
}

// Each slider's ends are where a face still looks like a plausible person of its race; past them the
// regional displacements start to fight the base sculpt and the face turns bizarre.
const def = (key: NumericKey, label: string, group: Group, defaultValue: number, min = 0, max = 1): NumericDef => ({
  key,
  label,
  group,
  min,
  max,
  step: 0.01,
  default: defaultValue,
});

export const NUMERIC_DEFS: NumericDef[] = [
  def("age", "Age", "Body", 0.3),
  def("weight", "Weight", "Body", 0.5, 0.15, 0.85),
  def("muscle", "Muscle", "Body", 0.45, 0.1, 0.9),
  def("brow", "Brow ridge", "Face", 0.5, 0.2, 0.8),
  def("cheekbones", "Cheekbones", "Face", 0.5, 0.2, 0.8),
  def("noseSize", "Nose size", "Face", 0.5, 0.25, 0.75),
  def("lips", "Lips", "Face", 0.5, 0.25, 0.75),
  def("jaw", "Jaw", "Face", 0.5, 0.2, 0.8),
  def("lids", "Heavy lids", "Face", 0.4, 0.1, 0.75),
  def("eyebrows", "Eyebrows", "Face", 0.5), // (0: none)
  def("horns", "Horn size", "Fantasy", 0.5),
  def("tusks", "Tusk size", "Fantasy", 0.5),
];

type Values = Partial<Record<NumericKey, number>>;

// A race's skeleton: the bone structure the sliders then adjust. Ratios are relative to a human
// (1.0). These stay inside the ranges real populations vary, plus the fantasy features (pointed ears,
// horns, tusks) that define a race. The "base" values are added to the matching slider, so a
// half-orc's brow is heavy even with the Brow ridge slider at its midpoint.
export interface Skeleton {
  headWidth: number; // skull breadth
  headHeight: number;
  earSize: number; // ~0.3 human, 1 long and pointed
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
  socketDepth: number;
  gaunt: number;
  shoulders: number; // shoulder breadth
}

export interface RaceInfo {
  label: string;
  skeleton: Skeleton;
  hornStyle: HornStyle;
  hairStyle: HairStyle;
  beardStyle?: BeardStyle; // (none if not given)
  // Slider values this race starts with (a heavy brow for a half-orc, heavy eyebrows for a dwarf)
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
  socketDepth: 0.45,
  gaunt: 0.15,
  shoulders: 1,
};

export const RACE_INFO: Record<Race, RaceInfo> = {
  human: { label: "Human", skeleton: HUMAN, hornStyle: "none", hairStyle: "swept", defaults: {} },
  // Narrow, long face with high cheekbones, a fine straight nose, delicate lips and a light brow
  elf: {
    label: "Elf",
    skeleton: { ...HUMAN, angularity: 0.45, headWidth: 0.93, headHeight: 1.04, earSize: 1, noseLength: 0.35, noseWidth: 0.86, noseBridge: 0.35, mouthWidth: 0.95, jaw: 0.86, chin: 0.3, browBase: -0.2, cheekBase: 0.25, lipBase: -0.1, gaunt: 0.25, socketDepth: 0.4, shoulders: 0.86 },
    hornStyle: "none",
    hairStyle: "swept",
    defaults: { eyebrows: 0.4 },
  },
  "half-elf": {
    label: "Half-elf",
    skeleton: { ...HUMAN, angularity: 0.4, headWidth: 0.97, headHeight: 1.02, earSize: 0.6, noseWidth: 0.95, noseBridge: 0.15, jaw: 0.94, browBase: -0.08, cheekBase: 0.12, gaunt: 0.2, shoulders: 0.94 },
    hornStyle: "none",
    hairStyle: "swept",
    defaults: {},
  },
  // Broad head, heavy brow, wide strong nose, full cheeks, a thick jaw and chin, a thick neck
  dwarf: {
    label: "Dwarf",
    skeleton: { ...HUMAN, angularity: 0.7, headWidth: 1.1, headHeight: 0.95, earSize: 0.25, noseLength: 0.5, noseWidth: 1.25, noseBridge: 0.3, jaw: 1.15, chin: 0.55, browBase: 0.3, cheekBase: 0.1, gaunt: 0, socketDepth: 0.5, shoulders: 1.25 },
    hornStyle: "none",
    hairStyle: "cropped",
    beardStyle: "full",
    defaults: { eyebrows: 0.85, muscle: 0.7, weight: 0.6 },
  },
  // Round, soft face: full cheeks, a small button nose, a gentle brow
  halfling: {
    label: "Halfling",
    skeleton: { ...HUMAN, angularity: 0.08, headWidth: 1.07, headHeight: 0.96, earSize: 0.55, noseLength: 0.15, noseWidth: 0.85, noseBridge: -0.3, jaw: 0.85, chin: 0.18, browBase: -0.2, cheekBase: 0.4, lipBase: 0.15, gaunt: 0, shoulders: 0.8 },
    hornStyle: "none",
    hairStyle: "cropped",
    defaults: { muscle: 0.3, weight: 0.58 },
  },
  // Big expressive nose, pointed ears, full cheeks and a small chin
  gnome: {
    label: "Gnome",
    skeleton: { ...HUMAN, angularity: 0.3, headWidth: 1.03, headHeight: 0.98, earSize: 0.75, noseLength: 0.98, noseWidth: 1.3, noseBridge: 0.3, chin: 0.15, browBase: 0.05, cheekBase: 0.15, gaunt: 0.1, shoulders: 0.78 },
    hornStyle: "none",
    hairStyle: "cropped",
    defaults: { muscle: 0.3 },
  },
  // Sloped forehead, a very heavy brow, a broad flat nose, high cheekbones, and a heavy jutting jaw
  "half-orc": {
    label: "Half-orc",
    skeleton: { ...HUMAN, angularity: 0.95, headWidth: 1.08, headHeight: 1, earSize: 0.4, noseLength: 0.3, noseWidth: 1.2, noseBridge: -0.3, mouthWidth: 1.12, jaw: 1.12, chin: 0.6, prognathism: 0.35, slope: 0.6, browBase: 0.4, cheekBase: 0.15, lipBase: -0.15, socketDepth: 0.55, shoulders: 1.3 },
    hornStyle: "none",
    hairStyle: "mohawk",
    defaults: { tusks: 0.6, muscle: 0.75, lids: 0.65, eyebrows: 0.8 },
  },
  // Angular: sharp cheekbones, a defined jaw, an arched brow and slightly pointed ears
  tiefling: {
    label: "Tiefling",
    skeleton: { ...HUMAN, angularity: 0.78, earSize: 0.55, noseWidth: 0.92, noseBridge: 0.2, jaw: 0.95, chin: 0.5, browBase: 0.15, cheekBase: 0.3, gaunt: 0.3, shoulders: 0.98 },
    hornStyle: "demon",
    hairStyle: "swept",
    defaults: { horns: 0.85 },
  },
};

export function defaultParams(): Params {
  const params = {
    race: "human" as Race,
    body: "masculine" as Body,
    hornStyle: "none" as HornStyle,
    hairStyle: "swept" as HairStyle,
    beardStyle: "none" as BeardStyle,
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
  tusks: number; // only half-orcs have tusks; zero for everyone else
  brow: number; // brow ridge: the slider plus the race's baseline
  cheek: number;
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
    tusks: p.race === "half-orc" ? p.tusks : 0,
    gaunt: clamp01(sk.gaunt + 0.35 * p.age + 0.9 * (0.5 - p.weight)),
    fullness: clamp01((p.weight - 0.5) * 2),
    lipFull: 0.7 + 1.0 * clamp01(p.lips + sk.lipBase),
    shoulders: sk.shoulders * (0.9 + 0.28 * p.muscle + 0.14 * (p.weight - 0.5)),
    neckGirth: 1 + 0.25 * (p.muscle - 0.45) + 0.2 * (p.weight - 0.5),
  };
}

// Switching race changes only the race: its bone structure (and fantasy anatomy such as tusks) comes
// from the race, and every slider and style the user has set is kept.
export function switchRace(current: Params, race: Race): Params {
  return { ...current, race };
}

// Applying a race's defaults resets every slider to its starting point and applies the race's own
// defaults, hair style, beard and horns. The build carries over.
export function applyRace(current: Params, race: Race): Params {
  const info = RACE_INFO[race];
  const next = defaultParams();
  next.race = race;
  next.body = current.body;
  next.hornStyle = info.hornStyle;
  next.hairStyle = info.hairStyle;
  next.beardStyle = info.beardStyle ?? "none";
  Object.assign(next, info.defaults);
  return clampParams(next);
}

// rng is injectable so tests can pass a seeded generator and get repeatable results.
export function randomParams(rng: () => number = Math.random): Params {
  const pick = <T>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  const race = pick(RACES);
  const params = applyRace(defaultParams(), race);
  params.body = pick(BODIES);
  params.hairStyle = pick(HAIR_STYLES);
  params.beardStyle = pick(BEARD_STYLES);
  // Fantasy features belong to the race, so only the anatomical sliders are randomized.
  const keep: NumericKey[] = ["horns", "tusks"];
  for (const d of NUMERIC_DEFS) {
    if (keep.includes(d.key)) continue;
    const raw = d.min + rng() * (d.max - d.min);
    params[d.key] = Math.round(raw / d.step) * d.step;
  }
  return clampParams(params);
}
