import type { Action, DamageRoll, DamageType, Monster } from "../types/monster";
import { matchesFilters, EMPTY_FILTERS } from "./filters";
import { createLiveGenerator } from "./liveGenerator";
import { offlineGenerator, type GenerateRequest, type Generator, type GeneratorResult, type ReskinRequest } from "./generatorApi";
import { slugify } from "./exportCommon";
import { DAMAGE_THEMES, DAMAGE_TYPES } from "./options";

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

const DAMAGE_WORD = /([a-z]+) damage/g;

/** The damage types written as "<type> damage" in some text. */
function typesNamedIn(text: string | null | undefined): DamageType[] {
  const found: DamageType[] = [];
  for (const match of (text ?? "").toLowerCase().matchAll(DAMAGE_WORD)) {
    if ((DAMAGE_TYPES as readonly string[]).includes(match[1])) found.push(match[1] as DamageType);
  }
  return found;
}

/**
 * The damage types a monster DEALS, sorted: those are the ones a reskin can swap. It counts attack and save damage and the
 * damage named in the text of actions, bonus actions, reactions and legendary options (most SRD breath weapons are text).
 * It does not count what the monster resists, is immune to or is vulnerable to, nor damage mentioned in a trait (usually
 * damage the monster takes). A zombie is immune to poison but deals only bludgeoning, so only bludgeoning is offered.
 */
export function damageDealtBy(monster: Monster): DamageType[] {
  const found = new Set<DamageType>();
  const add = (types: DamageType[]) => types.forEach((t) => found.add(t));
  for (const action of [...monster.actions, ...monster.bonus_actions, ...monster.reactions]) {
    if (action.kind === "attack") {
      add(action.damage.map((r) => r.type));
      add(typesNamedIn(action.effects_text));
    } else if (action.kind === "save") {
      add(action.on_fail.map((r) => r.type));
      add(typesNamedIn(action.effects_text));
    } else {
      add(typesNamedIn(action.text)); // a multiattack or a text action
    }
  }
  for (const option of monster.legendary_actions?.options ?? []) add(typesNamedIn(option.text));
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
      const { base, damageSwap, theme, move, levelUp } = request;
      let monster: Monster = base;
      const changes: string[] = [];
      if (damageSwap) {
        monster = swapDamageType(monster, damageSwap.from, damageSwap.to);
        changes.push(`Damage swap: ${damageSwap.from} → ${damageSwap.to}`);
      }
      // A remix theme swaps the monster's first damage type. The real server also trades defences and adds a move.
      const themeChosen = theme && theme !== "surprise" ? theme : null;
      const main = damageDealtBy(base)[0];
      if (themeChosen && main && main !== themeChosen) {
        monster = swapDamageType(monster, main, themeChosen);
        changes.push(`Main damage: ${main} → ${themeChosen}`);
      }
      const label = [damageSwap?.to ?? themeChosen, levelUp ? "level up" : null].filter(Boolean).join(" ");
      const name = `${base.name} (${label || "reskin"})`;
      const id = `demo-${unique()}-${slugify(name)}`;
      const notes = ["Demo mode: only the damage type was swapped. Numbers, signature moves and level-ups are not applied."];
      if (move) changes.push("Demo mode: signature moves are not added.");
      return Promise.resolve(
        ok(
          { ...monster, id, name, source: "reskin", validated: false, parent_id: base.id, generator: "demo", attribution: null, changes },
          notes,
        ),
      );
    },
  };
}

/**
 * Picks the generator. "?generator=demo" in the page address gives the demo one. Otherwise, if a server address was
 * configured when the page was built (VITE_API_URL), the live one. Otherwise the offline one.
 *
 * The server address deliberately does NOT come from the page address: a crafted link could point the page at someone
 * else's server.
 */
export function createGenerator(search: string, library: Monster[], serverUrl?: string): Generator {
  if (new URLSearchParams(search).get("generator") === "demo") return createDemoGenerator(library);
  const url = serverUrl?.trim();
  if (url && /^https?:\/\//.test(url)) return createLiveGenerator(url);
  return offlineGenerator;
}
