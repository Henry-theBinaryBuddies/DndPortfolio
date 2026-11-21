// The Spells step: for each class that casts, its cantrips, the spells it knows (or the wizard's spellbook), and the
// spells you prepare today, each counted from that class's own level. Spell picks from elsewhere (a high elf's cantrip,
// a warlock's Mystic Arcanum) appear here too, under their own keys (see expand.ts).
//
//   spells.srd-5.1:wizard.cantrips     ["srd-5.1:fire-bolt", ...]   cantrips known
//   spells.srd-5.1:bard.known          [...]                        spells known (known and pact casters)
//   spells.srd-5.1:wizard.spellbook    [...]                        the spells in the book (spellbook casters)
//   spells.srd-5.1:wizard.prepared     [...]                        prepared today: optional, as it changes every day
//
// Slots: a single caster uses its own table. With two or more classes that cast (not counting Pact Magic), the
// multiclass table decides, from the caster level: every level of a full caster, half of a half caster's (rounded
// down), a third of a third caster's. Pact Magic slots stay separate.
import type { ChoiceSpec, ContentEntry } from "../../../core";
import { modifier } from "../engine/derive";
import { grant, spellOption } from "../engine/expand";
import { picksOf, type Context, type Source } from "../engine/context";
import { bonusesFor } from "../engine/tally";
import type { Class, Item, Spell } from "../packFormat";
import { ABILITY_NAMES, type Ability } from "../vocabulary";
import { columnsAt } from "./class";
import { METHOD_KEY } from "./equipment";

export const SPELLS_STEP = { id: "spells", label: "Spells" };
const STEP = SPELLS_STEP.id;

type SpellEntry = Spell & { ref: string; pack: string };
type ClassEntry = Class & { ref: string; pack: string };

/** The multiclass spellcaster table: slots of each spell level (1st first) by caster level, 1 to 20. */
export const MULTICLASS_SLOTS: number[][] = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** The levels of a class that count towards the caster level. */
export function casterLevels(progression: NonNullable<NonNullable<Class["spellcasting"]>["progression"]>, level: number): number {
  return progression === "half" ? Math.floor(level / 2) : progression === "third" ? Math.floor(level / 3) : progression === "pact" ? 0 : level;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

export function spellsStep(ctx: Context, base: Record<Ability, number>): void {
  ctx.steps.push(SPELLS_STEP);
  const { content, tally } = ctx;
  const note = (id: string, message: string): void => {
    ctx.issues.push({ id, severity: "warning", step: STEP, overridable: false, message });
  };

  const classes = tally.classes
    .map((c) => ({ c, cls: content.get("classes", c.ref) as unknown as ClassEntry | undefined }))
    .filter((x): x is { c: (typeof tally.classes)[number]; cls: ClassEntry } => Boolean(x.cls));
  if (!classes.length) return;
  const casting = classes.filter(({ c, cls }) => cls.spellcasting && cls.spellcasting.level <= c.level);
  const single = classes.length === 1;
  for (const { c, cls } of classes) {
    const sc = cls.spellcasting;
    if (!sc && single) note("no-spellcasting", `The ${cls.name} doesn't cast spells at level ${c.level}.`);
    if (sc && sc.level > c.level) note(single ? "no-spellcasting" : `no-spellcasting:${cls.ref}`, `The ${cls.name} starts casting spells at ${single ? "level" : `${cls.name} level`} ${sc.level}.`);
  }

  // Shared slots, when two or more classes cast (Pact Magic aside).
  const sharing = casting.filter(({ cls }) => cls.spellcasting!.progression !== "pact" && cls.spellcasting!.kind !== "pact");
  const shared = sharing.length >= 2;
  if (shared) {
    const casterLevel = sharing.reduce((t, { c, cls }) => t + casterLevels(cls.spellcasting!.progression ?? "full", c.level), 0);
    const slots: Record<number, number> = {};
    MULTICLASS_SLOTS[Math.min(20, casterLevel)].forEach((n, i) => (slots[i + 1] = n));
    tally.casting.push({ name: `Multiclass spellcaster (caster level ${casterLevel})`, slots });
  }

  const firstRef = classes[0].cls.ref;
  for (const { c, cls } of casting) {
    classSpells(ctx, base, cls, c.level, c.subclass, shared && cls.spellcasting!.kind !== "pact", { first: cls.ref === firstRef, alone: casting.length === 1 });
  }
}

/** One class's spells: cantrips, spells known or the spellbook, and prepared spells, from its own level and table. */
/** `first`: the first class, whose issue ids stay as they were before multiclassing (so saved DM rulings still match); `alone`: the only class that casts. */
function classSpells(
  ctx: Context, base: Record<Ability, number>, cls: ClassEntry, level: number, subclass: string | undefined, shared: boolean,
  { first, alone }: { first: boolean; alone: boolean },
): void {
  const { doc, content, tally } = ctx;
  const sc = cls.spellcasting!;
  const columns = columnsAt(cls.columns, level);
  const count = (column?: string) => (column ? Number(columns[column]) || 0 : 0);
  // The class's own table says the highest level it can learn, even when a multiclass character's slots go higher.
  const own: Record<number, number> = {};
  for (const [l, column] of Object.entries(sc.slots)) if (count(column) > 0) own[Number(l)] = count(column);
  const maxLevel = Math.max(0, ...Object.keys(own).map(Number));
  tally.casting.push({ name: cls.name, ability: sc.ability, slots: shared ? {} : own, pact: sc.kind === "pact" });
  // Spells the class or its subclass gives (a domain's) are cast with the class's ability unless they say otherwise.
  for (const s of tally.spells) if (!s.ability && s.from.step === "class" && (s.from.name === cls.name || s.from.name === subclass)) s.ability = sc.ability;

  const listId = sc.list ?? cls.id;
  // Spells added to a list: a class's or subclass's only to its own (a Fiend's to the warlock's); others' to every class's.
  const expanded = new Set(tally.expandedSpells.filter((e) => e.from.step !== "class" || e.from.name === cls.name || e.from.name === subclass).map((e) => e.ref));
  const list = (content.list("spells") as unknown as SpellEntry[])
    .filter((s) => s.classes.includes(listId) || expanded.has(s.ref))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const source: Source = { key: `spells.${cls.ref}`, name: cls.name, step: STEP, pack: cls.pack, effects: [] };
  const from = (choice: string) => ({ name: cls.name, step: STEP, choice });

  /** Opens a spell-list choice and grants what's picked, cast with the class's ability. */
  const choose = (id: string, label: string, options: SpellEntry[], n: number, extra: Partial<ChoiceSpec> = {}, apply = true) => {
    const key = `${source.key}.${id}`;
    const picks = picksOf(doc.choices[key]);
    ctx.open.push({
      spec: {
        key, step: STEP, label, source: `${cls.name} ${level}`, kind: n === 1 && !extra.count ? "pick-one" : "pick-many", presentation: "list", required: true,
        options: options.map(spellOption), ...(n === 1 && !extra.count ? {} : { count: { min: n, max: n } }), ...extra,
      },
      picks,
      ...(apply ? { collection: "spells" as const } : {}),
    });
    if (apply) for (const pick of new Set(picks)) if (options.some((o) => o.ref === pick)) grant(ctx, source, "spells", pick, from(key), 1, { ability: sc.ability });
    return picks;
  };
  const leveled = list.filter((s) => s.level >= 1 && s.level <= maxLevel);
  const levelWords = maxLevel === 1 ? "1st-level" : `1st- to ${ORDINAL[maxLevel]}-level`;

  const cantrips = count(sc.cantrips);
  if (cantrips) choose("cantrips", `${cls.name} cantrips (${cantrips})`, list.filter((s) => s.level === 0), cantrips);
  if (sc.kind === "known" || sc.kind === "pact") {
    // Spells chosen from any class that count among the spells known (Magical Secrets) leave fewer to choose here.
    const elsewhere = ctx.open
      .filter((o) => o.source?.key === `class.${cls.ref}` && o.effect && "collection" in o.effect.from && o.effect.from.known)
      .reduce((t, o) => t + (o.spec.count?.max ?? 1), 0);
    const known = count(sc.known) - elsewhere;
    if (known > 0) {
      choose("known", `${cls.name} spells known (${known})`, leveled, known, {
        hint: `${levelWords} spells from the ${listId} spell list.${elsewhere ? ` Your ${elsewhere} spells from Magical Secrets count among the ${count(sc.known)} you know.` : ""}`,
      });
    }
  }
  let book: string[] = [];
  if (sc.kind === "spellbook" && sc.spellbook) {
    const n = sc.spellbook.start + sc.spellbook.perLevel * (level - 1);
    book = choose("spellbook", `Spellbook: ${levelWords} ${listId} spells (${n})`, leveled, n);
  }
  // Prepared spells; a spellbook caster's come from the book, so not until it has some.
  if (sc.kind === "prepared" || (sc.kind === "spellbook" && book.length > 0)) {
    const score = base[sc.ability] + bonusesFor(tally, sc.ability).reduce((t, b) => t + b.amount, 0);
    const mod = modifier(score);
    const levels = sc.prepare === "half-level" ? Math.floor(level / 2) : level;
    const n = Math.max(1, mod + levels);
    const always = new Set(tally.spells.filter((s) => s.always).map((s) => s.ref));
    const options = sc.kind === "spellbook" ? leveled.filter((s) => book.includes(s.ref)) : leveled.filter((s) => !always.has(s.ref));
    const picks = choose("prepared", alone ? "Prepared today (optional)" : `${cls.name}: prepared today (optional)`, options, n, {
      required: false,
      count: { min: 0, max: n },
      hint: `${ABILITY_NAMES[sc.ability]} modifier (${mod >= 0 ? "+" : "−"}${Math.abs(mod)}) + ${sc.prepare === "half-level" ? `half your ${cls.name} level` : `your ${cls.name} level`} (${levels}) = ${n}, at least 1. ` +
        `You can change these after each long rest${always.size ? "; always-prepared spells don't count" : ""}.` +
        (sc.kind === "spellbook" ? " Choose from your spellbook." : ""),
    }, sc.kind === "prepared");
    for (const s of tally.spells) if (picks.includes(s.ref)) s.prepared = true;
  }

  // A focus or a component pouch, once the equipment is decided.
  const classSpells = tally.spells.filter((s) => s.from.name === cls.name && s.from.step === STEP);
  if (doc.choices[METHOD_KEY] !== undefined && classSpells.length) {
    const carried = tally.items.map((i) => (i.ref ? (content.get("items", i.ref) as (ContentEntry & Item) | undefined) : undefined));
    const focus = carried.some((i) => i && (i.id === "component-pouch" || (sc.focus ?? []).some((c) => i.categories?.includes(c))));
    if (!focus) {
      ctx.issues.push({
        id: first ? "no-focus" : `no-focus:${cls.ref}`, severity: "warning", step: STEP, overridable: true,
        message: `For ${cls.name} spells with material components, carry a component pouch or a spellcasting focus (see Equipment).`,
      });
    }
  }
}
