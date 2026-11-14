// The 2014 rule for duplicates: if two sources give the same proficiency, the character chooses a different one of
// the same kind instead. A skill given twice by fixed effects (an Elf's Perception, then a background's) opens a
// choice of another skill on the later source's step. (A pick that duplicates is reported by the check stage instead.)
// Skills only for now: other kinds have no list to choose from until items exist.
import { listName, openChoice } from "./expand";
import type { Context } from "./context";

export function replaceDuplicateSkills(ctx: Context): void {
  const first = new Map<string, string>(); // skill → the source that gave it first
  for (const p of [...ctx.tally.proficiencies]) {
    if (p.kind !== "skill") continue;
    const earlier = first.get(p.id);
    if (earlier === undefined) {
      first.set(p.id, p.from.name);
      continue;
    }
    if (p.from.choice || earlier === p.from.name || !p.from.step) continue;
    p.replaced = true;
    openChoice(
      ctx,
      { key: `${p.from.step}.replace`, name: p.from.name, step: p.from.step, pack: "", effects: [] },
      {
        type: "choice", id: p.id, pick: 1,
        label: `${p.from.name} gives ${listName("skills", p.id)}, which you already have from ${earlier}: choose another skill`,
        from: { list: "skills" }, each: { type: "proficiency", kind: "skill" },
      },
    );
  }
}
