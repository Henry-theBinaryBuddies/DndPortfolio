// Turns the 5e-bits SRD 5.1 backgrounds (only the Acolyte) into the 2014 format. Pure: data in, entries out.
// Starting equipment waits for the Equipment step.
import type { Background, Effect } from "../../frontend/src/systems/dnd5e-2014/packFormat";
import type { RawBackground, RawRef } from "./raw";

/** One line per background, in our own words: the SRD has no summaries. */
const SUMMARIES: Record<string, string> = {
  acolyte: "A life spent in service to a temple, as an intermediary between the holy and the mortal world.",
};

/** The 5e-bits files spell an ideal's alignment out as a list; the SRD gives one word ("Lawful", "Good", "Any"). */
export function alignmentWord(alignments: RawRef[]): string {
  const names = alignments.map((a) => a.name);
  if (names.length >= 9) return "Any";
  for (const word of ["Lawful", "Chaotic"]) if (names.every((n) => n.startsWith(word))) return word;
  for (const word of ["Good", "Evil"]) if (names.every((n) => n.endsWith(word))) return word;
  if (names.every((n) => n.includes("Neutral"))) return "Neutral";
  throw new Error(`No one word for the alignments ${names.join(", ")}.`);
}

export function buildBackgrounds(raw: RawBackground[]): Background[] {
  return raw.map((b) => {
    const effects: Effect[] = b.starting_proficiencies.map((p) => {
      if (!p.index.startsWith("skill-")) throw new Error(`${b.name}: the proficiency "${p.index}" is not a skill; tools arrive with items.`);
      return { type: "proficiency", kind: "skill", id: p.index.slice(6) };
    });
    if (b.language_options) {
      const n = b.language_options.choose;
      effects.push({ type: "choice", id: "languages", label: `Choose ${n === 2 ? "two languages" : n === 1 ? "one language" : `${n} languages`}`, pick: n, from: { collection: "languages" } });
    }
    effects.push({ type: "feature", name: b.feature.name, description: b.feature.desc.join("\n\n") });
    return {
      id: b.index,
      name: b.name,
      summary: SUMMARIES[b.index],
      effects,
      characteristics: {
        traits: b.personality_traits.from.options.map((o) => o.string),
        ideals: b.ideals.from.options.map((o) => ({ text: o.desc, alignment: alignmentWord(o.alignments) })),
        bonds: b.bonds.from.options.map((o) => o.string),
        flaws: b.flaws.from.options.map((o) => o.string),
      },
    };
  });
}
