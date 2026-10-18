import type {
  Ability,
  Action,
  AttackAction,
  DamageRoll,
  MultiattackAction,
  Recharge,
  SaveAction,
} from "../types/monster";
import { formatDamageRoll } from "./dice";

// Turns structured actions into stat-block prose. The numbers in the text are
// computed from the stored dice and bonuses, so they can never disagree.

/** A piece of text, optionally italic (stat blocks italicise "Hit:" and similar). */
export interface Segment {
  text: string;
  italic?: boolean;
}

export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const ATTACK_LABELS: Record<AttackAction["attack"]["mode"], string> = {
  melee_weapon: "Melee Weapon Attack",
  ranged_weapon: "Ranged Weapon Attack",
  melee_spell: "Melee Spell Attack",
  ranged_spell: "Ranged Spell Attack",
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function segmentsToText(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

/** "Stormbreath (Recharge 5-6)"; attacks and multiattack have no recharge. */
export function actionName(action: Action): string {
  if ((action.kind === "save" || action.kind === "text") && action.recharge) {
    return `${action.name} (${rechargeLabel(action.recharge)})`;
  }
  return action.name;
}

function rechargeLabel({ min }: Recharge): string {
  return min >= 6 ? "Recharge 6" : `Recharge ${min}–6`;
}

function damageList(rolls: DamageRoll[]): string {
  return rolls.map((r) => `${formatDamageRoll(r.dice, r.bonus)} ${r.type} damage`).join(" plus ");
}

function withEffects(text: string, effects?: string | null): string {
  return effects ? `${text} ${effects}` : text;
}

function renderAttack(action: AttackAction): Segment[] {
  const { mode, to_hit, reach, range, targets } = action.attack;
  const sign = to_hit >= 0 ? "+" : "-";
  const distances: string[] = [];
  if (reach !== undefined) distances.push(`reach ${reach} ft.`);
  if (range) distances.push(`range ${range.normal}/${range.long} ft.`);

  const lead = ` ${sign}${Math.abs(to_hit)} to hit, ${distances.join(" or ")}, ${targets}. `;
  return [
    { text: `${ATTACK_LABELS[mode]}:`, italic: true },
    { text: lead },
    { text: "Hit:", italic: true },
    { text: withEffects(` ${damageList(action.damage)}.`, action.effects_text) },
  ];
}

const AREA_PHRASES: Record<NonNullable<SaveAction["area"]>["shape"], (size: number, width?: number) => string> = {
  radius: (size) => `${size}-foot radius`,
  cone: (size) => `${size}-foot cone`,
  cube: (size) => `${size}-foot cube`,
  sphere: (size) => `${size}-foot-radius sphere`,
  line: (size, width) => `${size}-foot line${width ? ` that is ${width} feet wide` : ""}`,
};

function renderSave(action: SaveAction): Segment[] {
  const { save, area, on_fail, on_success, effects_text } = action;
  const who = area ? `Each creature in a ${AREA_PHRASES[area.shape](area.size, area.width)}` : "The target";
  let text = `${who} must make a DC ${save.dc} ${ABILITY_NAMES[save.ability]} saving throw`;

  if (on_fail.length > 0) {
    text += `, taking ${damageList(on_fail)} on a failed save`;
    if (on_success === "half") text += ", or half as much damage on a successful one";
  }
  return [{ text: withEffects(`${text}.`, effects_text) }];
}

/**
 * Multiattack names other actions, so the prose is built from the sequence:
 * "makes two cutlass attacks" for one entry, or
 * "makes three attacks: one with its bite and two with its claws" for several.
 * Plurals are naive (adds an "s"); set `text` on the action to override.
 */
function renderMultiattack(action: MultiattackAction, monsterName: string): Segment[] {
  const subject = `The ${monsterName.toLowerCase()}`;
  if (action.text) return [{ text: action.text }];

  const { sequence } = action;
  if (sequence.length === 1) {
    const { action: name, count } = sequence[0];
    return [{ text: `${subject} makes ${numberWord(count)} ${name.toLowerCase()} attack${count > 1 ? "s" : ""}.` }];
  }

  const total = sequence.reduce((sum, entry) => sum + entry.count, 0);
  const parts = sequence.map(
    ({ action: name, count }) => `${numberWord(count)} with its ${name.toLowerCase()}${count > 1 ? "s" : ""}`,
  );
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return [{ text: `${subject} makes ${numberWord(total)} attacks: ${joined}.` }];
}

/** Prose for any action kind. `monsterName` is only used by multiattack. */
export function renderAction(action: Action, monsterName: string): Segment[] {
  switch (action.kind) {
    case "attack":
      return renderAttack(action);
    case "save":
      return renderSave(action);
    case "multiattack":
      return renderMultiattack(action, monsterName);
    case "text":
      return [{ text: action.text }];
  }
}
