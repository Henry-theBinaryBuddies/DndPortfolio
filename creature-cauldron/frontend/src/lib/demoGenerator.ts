import type { Action, DamageRoll, DamageType, Monster } from "../types/monster";
import { matchesFilters, EMPTY_FILTERS } from "./filters";
import { offlineGenerator, type GenerateRequest, type Generator, type GeneratorResult, type ReskinRequest } from "./generatorApi";
import { slugify } from "./exportCommon";
import { DAMAGE_THEMES } from "./options";

// A stand-in generator for trying the Generate and Reskin buttons before the real server exists. It makes
// no network calls and no AI calls: it copies and lightly renames monsters from the library. Its numbers are
// NOT checked or recalculated, so everything it makes is marked unvalidated. It runs only when the page is
// opened with ?generator=demo.

const PREFIXES = ["Ashen", "Gilded", "Hollow", "Thorned", "Gloaming", "Rimed", "Sunken", "Vagrant"];

/** Every use of `from` replaced with `to` across a monster's damage, resistances and themes. */
export function swapDamageType(monster: Monster, from: DamageType, to: DamageType): Monster {
  const swapRoll = (roll: DamageRoll): DamageRoll => (roll.type === from ? { ...roll, type: to } : roll);
  const swapList = <T extends string>(list: T[]): T[] => [...new Set(list.map((t) => (t === from ? (to as unknown as T) : t)))];
  const swapAction = (action: Action): Action => {
    if (action.kind === "attack") return { ...action, damage: action.damage.map(swapRoll) };
    if (action.kind === "save") return { ...action, on_fail: action.on_fail.map(swapRoll) };
    return action;
  };
  return {
    ...monster,
    actions: monster.actions.map(swapAction),
    bonus_actions: monster.bonus_actions.map(swapAction),
    reactions: monster.reactions.map(swapAction),
    resistances: swapList(monster.resistances),
    immunities: swapList(monster.immunities),
    vulnerabilities: swapList(monster.vulnerabilities),
    // Themes are only the elemental types, so a swap to a weapon type just drops the theme.
    damage_themes: swapList(monster.damage_themes).filter((t) => (DAMAGE_THEMES as readonly string[]).includes(t)),
  };
}

/** The damage types a monster uses or resists, which are the ones a reskin can swap. */
export function damageTypesIn(monster: Monster): DamageType[] {
  const found = new Set<DamageType>();
  const fromRolls = (rolls: DamageRoll[]) => rolls.forEach((r) => found.add(r.type));
  for (const action of [...monster.actions, ...monster.bonus_actions, ...monster.reactions]) {
    if (action.kind === "attack") fromRolls(action.damage);
    if (action.kind === "save") fromRolls(action.on_fail);
  }
  [...monster.resistances, ...monster.immunities, ...monster.vulnerabilities].forEach((t) => found.add(t));
  return [...found].sort();
}

export function createDemoGenerator(library: Monster[]): Generator {
  let count = 0;
  const unique = () => `${Date.now().toString(36)}-${count++}`;

  const ok = (monster: Monster, notes: string[]): GeneratorResult => ({ ok: true, monster, notes });

  return {
    mode: "demo",

    generate(request: GenerateRequest): Promise<GeneratorResult> {
      const matches = library.filter((m) => matchesFilters(m, { ...EMPTY_FILTERS, ...request }));
      const pool = matches.length > 0 ? matches : library;
      if (pool.length === 0) {
        return Promise.resolve({ ok: false, reason: "error", message: "The demo library is empty." });
      }
      const base = pool[count % pool.length];
      const name = `${PREFIXES[count % PREFIXES.length]} ${base.name}`;
      const id = `demo-${unique()}-${slugify(name)}`;
      const notes = ["Demo mode: a renamed copy of a library monster. The real generator will write original ones."];
      if (matches.length === 0) notes.push("Nothing in the library matched, so any monster was copied.");
      return Promise.resolve(
        ok({ ...base, id, name, source: "ai", validated: false, parent_id: base.id, generator: "demo", attribution: null }, notes),
      );
    },

    reskin(request: ReskinRequest): Promise<GeneratorResult> {
      const { base, damageSwap, template } = request;
      let monster: Monster = base;
      if (damageSwap) monster = swapDamageType(monster, damageSwap.from, damageSwap.to);
      const label = [damageSwap ? `${damageSwap.to}` : null, template === "elite" ? "elite" : null].filter(Boolean).join(" ");
      const name = `${base.name} (${label || "reskin"})`;
      const id = `demo-${unique()}-${slugify(name)}`;
      const notes = ["Demo mode: only the damage type was swapped. Numbers and the elite template are not applied."];
      return Promise.resolve(
        ok({ ...monster, id, name, source: "reskin", validated: false, parent_id: base.id, generator: "demo", attribution: null }, notes),
      );
    },
  };
}

/**
 * Picks the generator from the page address. "?generator=demo" gives the demo one; anything else is the
 * offline one. (The real server's address will be added here when it exists.)
 */
export function createGenerator(search: string, library: Monster[]): Generator {
  const mode = new URLSearchParams(search).get("generator");
  return mode === "demo" ? createDemoGenerator(library) : offlineGenerator;
}
