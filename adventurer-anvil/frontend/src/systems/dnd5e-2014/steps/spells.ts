// The Spells step: your class's cantrips, the spells it knows (or the wizard's spellbook), and the spells you prepare
// today. Spell picks from elsewhere (a high elf's cantrip) appear here too, under their own keys (see expand.ts).
//
//   spells.srd-5.1:wizard.cantrips     ["srd-5.1:fire-bolt", ...]   cantrips known
//   spells.srd-5.1:bard.known          [...]                        spells known (known and pact casters)
//   spells.srd-5.1:wizard.spellbook    [...]                        the spells in the book (spellbook casters)
//   spells.srd-5.1:wizard.prepared     [...]                        prepared today: optional, as it changes every day
import type { ChoiceSpec, ContentEntry } from "../../../core";
import { modifier } from "../engine/derive";
import { grant, spellOption } from "../engine/expand";
import { picksOf, type Context, type Source } from "../engine/context";
import { bonusesFor } from "../engine/tally";
import type { Class, Item, Spell } from "../packFormat";
import { ABILITY_NAMES, type Ability } from "../vocabulary";
import { CLASS_KEY, columnsAt } from "./class";
import { METHOD_KEY } from "./equipment";

export const SPELLS_STEP = { id: "spells", label: "Spells" };
const STEP = SPELLS_STEP.id;

type SpellEntry = Spell & { ref: string; pack: string };

export function spellsStep(ctx: Context, base: Record<Ability, number>): void {
  ctx.steps.push(SPELLS_STEP);
  const { doc, content, tally } = ctx;
  const note = (id: string, message: string): void => {
    ctx.issues.push({ id, severity: "warning", step: STEP, overridable: false, message });
  };

  const classRef = picksOf(doc.choices[CLASS_KEY])[0];
  const cls = classRef ? (content.get("classes", classRef) as unknown as (Class & { ref: string; pack: string }) | undefined) : undefined;
  if (!cls) return;
  const level = tally.classes.find((c) => c.ref === cls.ref)?.level ?? 1;
  const sc = cls.spellcasting;
  if (!sc) return note("no-spellcasting", `The ${cls.name} doesn't cast spells at level ${level}.`);
  if (sc.level > level) return note("no-spellcasting", `The ${cls.name} starts casting spells at level ${sc.level}.`);

  const columns = columnsAt(cls.columns, level);
  const count = (column?: string) => (column ? Number(columns[column]) || 0 : 0);
  const slots: Record<number, number> = {};
  for (const [l, column] of Object.entries(sc.slots)) if (count(column) > 0) slots[Number(l)] = count(column);
  const maxLevel = Math.max(0, ...Object.keys(slots).map(Number));
  tally.casting.push({ name: cls.name, ability: sc.ability, slots, pact: sc.kind === "pact" });
  // Spells the class or its subclass gives (a domain's) are cast with the class's ability unless they say otherwise.
  for (const s of tally.spells) if (!s.ability && s.from.step === "class") s.ability = sc.ability;

  const listId = sc.list ?? cls.id;
  const expanded = new Set(tally.expandedSpells.map((e) => e.ref));
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
        key, step: STEP, label, source: cls.name, kind: n === 1 && !extra.count ? "pick-one" : "pick-many", presentation: "list", required: true,
        options: options.map(spellOption), ...(n === 1 && !extra.count ? {} : { count: { min: n, max: n } }), ...extra,
      },
      picks,
      ...(apply ? { collection: "spells" as const } : {}),
    });
    if (apply) for (const pick of new Set(picks)) if (options.some((o) => o.ref === pick)) grant(ctx, source, "spells", pick, from(key), 1, { ability: sc.ability });
    return picks;
  };
  const leveled = list.filter((s) => s.level >= 1 && s.level <= maxLevel);
  const levelWords = maxLevel === 1 ? "1st-level" : `1st- to ${maxLevel === 2 ? "2nd" : maxLevel === 3 ? "3rd" : `${maxLevel}th`}-level`;

  const cantrips = count(sc.cantrips);
  if (cantrips) choose("cantrips", `${cls.name} cantrips (${cantrips})`, list.filter((s) => s.level === 0), cantrips);
  if (sc.kind === "known" || sc.kind === "pact") {
    const known = count(sc.known);
    if (known) choose("known", `${cls.name} spells known (${known})`, leveled, known, { hint: `${levelWords} spells from the ${listId} spell list.` });
  }
  let book: string[] = [];
  if (sc.kind === "spellbook" && sc.spellbook) {
    const n = sc.spellbook.start + sc.spellbook.perLevel * (level - 1);
    book = choose("spellbook", `Spellbook: ${levelWords} ${listId} spells (${n})`, leveled, n);
  }
  if (sc.kind === "prepared" || sc.kind === "spellbook") {
    const score = base[sc.ability] + bonusesFor(tally, sc.ability).reduce((t, b) => t + b.amount, 0);
    const mod = modifier(score);
    const levels = sc.prepare === "half-level" ? Math.floor(level / 2) : level;
    const n = Math.max(1, mod + levels);
    const always = new Set(tally.spells.filter((s) => s.always).map((s) => s.ref));
    const options = sc.kind === "spellbook" ? leveled.filter((s) => book.includes(s.ref)) : leveled.filter((s) => !always.has(s.ref));
    const picks = choose("prepared", "Prepared today (optional)", options, n, {
      required: false,
      count: { min: 0, max: n },
      hint: `${ABILITY_NAMES[sc.ability]} modifier (${mod >= 0 ? "+" : "−"}${Math.abs(mod)}) + ${sc.prepare === "half-level" ? "half your level" : "your level"} (${levels}) = ${n}, at least 1. ` +
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
        id: "no-focus", severity: "warning", step: STEP, overridable: true,
        message: `For ${cls.name} spells with material components, carry a component pouch or a spellcasting focus (see Equipment).`,
      });
    }
  }
}
