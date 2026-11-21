// The Details step: the character's name (required), alignment, appearance, personality (with the background's
// tables as suggestions), backstory, allies, notes and a portrait. Everything but the name is optional.
//
//   $name                        the character's name (kept in the file's own name field; see NAME_KEY)
//   details.alignment            "lawful-good" ... "chaotic-evil"
//   details.age / .height / .weight / .eyes / .skin / .hair    short text
//   background.traits / .ideal / .bond / .flaw                long text (keys kept from when they were on Background)
//   details.backstory / .allies / .notes                      long text
//   details.portrait             a data: URL of an image, 256 × 256 at most
import { NAME_KEY, type ChoiceSpec } from "../../../core";
import { picksOf, type Context } from "../engine/context";
import { feetAndInches, makeNames, namesFromLists, seeded, spread } from "../engine/suggest";
import type { Background, Race } from "../packFormat";
import { BACKGROUND_KEY } from "./background";

export const DETAILS_STEP = { id: "details", label: "Details" };
const STEP = DETAILS_STEP.id;

export const ALIGNMENT_KEY = "details.alignment";
export const PORTRAIT_KEY = "details.portrait";
/** The most a portrait may take in the file (the app shrinks pictures to 256 × 256 first). */
export const PORTRAIT_MAX_CHARS = 300_000;

/** The portrait, if it is a picture of an allowed kind and size; otherwise nothing. */
export function goodPortrait(value: unknown): string | undefined {
  return typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(value) && value.length <= PORTRAIT_MAX_CHARS ? value : undefined;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ETHICS = ["lawful", "neutral", "chaotic"] as const;
const MORALS = ["good", "neutral", "evil"] as const;
/** In reading order for a 3 × 3 grid: lawful good, neutral good, chaotic good; then the neutrals; then the evils. */
const ALIGNMENT_OPTIONS = MORALS.flatMap((m) =>
  ETHICS.map((e) => (e === "neutral" && m === "neutral" ? { value: "neutral", name: "Neutral" } : { value: `${e}-${m}`, name: `${capital(e)} ${m}` })),
);

export function detailsStep(ctx: Context): void {
  ctx.steps.push(DETAILS_STEP);
  const { doc, content } = ctx;
  const text = (key: string, label: string, opts: Partial<ChoiceSpec> & { lines?: number } = {}) => {
    const { lines, ...spec } = opts;
    const value = key === NAME_KEY ? doc.name : doc.choices[key];
    ctx.open.push({
      spec: { key, step: STEP, label, kind: "text", required: false, ...(lines && lines > 1 ? { count: { min: lines, max: lines } } : {}), ...spec },
      picks: [],
      answered: typeof value === "string" && value.trim() !== "",
    });
  };

  // The race and background, for suggestions.
  const raceRef = picksOf(doc.choices.race)[0];
  const race = raceRef ? (content.get("races", raceRef) as unknown as (Race & { ref: string }) | undefined) : undefined;
  const bgRef = picksOf(doc.choices[BACKGROUND_KEY])[0];
  const bg = bgRef ? (content.get("backgrounds", bgRef) as unknown as Background | undefined) : undefined;
  const s = race?.suggestions;
  const random = seeded(`${doc.id}|${race?.ref ?? ""}`);

  // Name: a pack's own lists if it has them (given names, each with a family name if there's a "family" list),
  // otherwise names built from its syllables.
  const names = s?.names ? namesFromLists(s.names, random, 12) : s?.nameParts ? makeNames(s.nameParts, random, 12) : [];
  text(NAME_KEY, "Name", {
    required: true,
    suggestions: names.map((n) => ({ text: n })),
    ...(race && !names.length ? { hint: `The loaded packs have no ${race.name.toLowerCase()} names to suggest.` } : {}),
    ...(names.length ? { source: race!.name } : {}),
  });

  // Alignment, with a note where the ideal written leans one way.
  const alignment = picksOf(doc.choices[ALIGNMENT_KEY]);
  const idealText = doc.choices["background.ideal"];
  const ideal = typeof idealText === "string" ? bg?.characteristics?.ideals?.find((i) => idealText.includes(i.text)) : undefined;
  const lean = ideal?.alignment && ideal.alignment.toLowerCase() !== "any" ? ideal.alignment : undefined;
  ctx.open.push({
    spec: {
      key: ALIGNMENT_KEY, step: STEP, label: "Alignment", kind: "pick-one", required: false, columns: 3, options: ALIGNMENT_OPTIONS,
      ...(lean ? { hint: `Your ideal (${ideal!.text.split(".")[0]}) leans ${capital(lean)}.` } : {}),
    },
    picks: alignment,
  });

  // Appearance: age, height and weight suggested inside the race's ranges.
  const group = "Appearance";
  const ages = s?.ageAdult && s.ageMax ? spread(s.ageAdult, s.ageAdult + (s.ageMax - s.ageAdult) * 0.4, random, 6).map(String) : [];
  const heights = s?.height ? spread(s.height.min, s.height.max, random, 6).map(feetAndInches) : [];
  const weights = s?.weight ? spread(s.weight.min, s.weight.max, random, 6).map((w) => `${w} lb`) : [];
  const from = (list: string[]) => (list.length ? { suggestions: list.map((t) => ({ text: t })), source: race!.name } : {});
  text("details.age", "Age", { group, ...from(ages) });
  text("details.height", "Height", { group, ...from(heights) });
  text("details.weight", "Weight", { group, ...from(weights) });
  text("details.eyes", "Eyes", { group });
  text("details.skin", "Skin", { group });
  text("details.hair", "Hair", { group });

  // Personality: free text, with the background's tables as suggestions. The keys date from the Background step.
  const c = bg?.characteristics;
  const plain = (list: string[] | undefined) => (list ?? []).map((t) => ({ text: t }));
  const fromBg = (list: { text: string }[]) => (list.length ? { source: bg!.name } : {});
  const traits = plain(c?.traits);
  const ideals = (c?.ideals ?? []).map((i) => ({ text: i.text, note: i.alignment ? capital(i.alignment) : undefined }));
  const bonds = plain(c?.bonds);
  const flaws = plain(c?.flaws);
  text("background.traits", "Personality traits (two)", { kind: "long-text", lines: 2, suggestions: traits, ...fromBg(traits) });
  text("background.ideal", "Ideal", { kind: "long-text", suggestions: ideals, ...fromBg(ideals) });
  text("background.bond", "Bond", { kind: "long-text", suggestions: bonds, ...fromBg(bonds) });
  text("background.flaw", "Flaw", { kind: "long-text", suggestions: flaws, ...fromBg(flaws) });

  text("details.backstory", "Backstory", { kind: "long-text" });
  text("details.allies", "Allies and organisations", { kind: "long-text" });
  text("details.notes", "Notes", { kind: "long-text" });

  // Portrait: an image the app has shrunk, kept in the file.
  const portrait = doc.choices[PORTRAIT_KEY];
  const valid = goodPortrait(portrait) !== undefined;
  ctx.open.push({
    spec: { key: PORTRAIT_KEY, step: STEP, label: "Portrait", kind: "image", required: false, hint: "A PNG, JPEG or WebP picture, shrunk to 256 × 256 and kept with the character." },
    picks: [],
    answered: valid,
  });
  if (portrait !== undefined && portrait !== null && !valid) {
    ctx.issues.push({
      id: "bad-portrait", severity: "error", step: STEP, key: PORTRAIT_KEY, overridable: false,
      message: "The portrait must be a PNG, JPEG or WebP picture of at most about 220 KB. Choose it again.",
    });
  }
}
