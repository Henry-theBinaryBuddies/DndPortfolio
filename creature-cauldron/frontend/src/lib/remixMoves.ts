import type { Monster } from "../types/monster";
import { damageDealtBy } from "./demoGenerator";

// The signature moves a remix can add. The server (backend/src/cauldron/remix/moves.py) builds every number; this list is
// only the menu the visitor chooses from, so a test in the backend keeps its keys, labels and groups equal to the server's.

export const MOVE_GROUPS = ["Offence", "Control", "Area", "Defence and mobility"] as const;
export type MoveGroup = (typeof MOVE_GROUPS)[number];

export interface RemixMove {
  key: string;
  label: string;
  group: MoveGroup;
  /** One plain sentence for the menu. */
  blurb: string;
  /** The monster must deal damage for this move to make sense. */
  needsDamage: boolean;
  /** The move moves a creature around, which a Tiny monster cannot do. */
  needsNotTiny: boolean;
}

/** The choice that leaves the decision to the server. */
export const SURPRISE = "surprise";

export const REMIX_MOVES: readonly RemixMove[] = [
  { key: "rider", label: "On-hit rider", group: "Offence", blurb: "An attack whose hit also inflicts a condition that fits the theme.", needsDamage: true, needsNotTiny: false },
  { key: "opening_strike", label: "Opening strike", group: "Offence", blurb: "A first blow that hits harder against a creature that has not yet acted.", needsDamage: true, needsNotTiny: false },
  { key: "drain", label: "Drain", group: "Offence", blurb: "An attack that heals the monster for half the damage it deals.", needsDamage: true, needsNotTiny: false },
  { key: "lob", label: "Lob", group: "Offence", blurb: "A ranged attack in the theme's damage, for monsters that otherwise fight up close.", needsDamage: true, needsNotTiny: false },
  { key: "sunder", label: "Sunder", group: "Offence", blurb: "A strike that damages the target's armor, lowering its AC briefly.", needsDamage: true, needsNotTiny: false },
  { key: "grasping_strike", label: "Grasping strike", group: "Control", blurb: "A hit that grapples and restrains the target.", needsDamage: true, needsNotTiny: false },
  { key: "slowing_touch", label: "Slowing touch", group: "Control", blurb: "A hit that can halve the target's speed.", needsDamage: true, needsNotTiny: false },
  { key: "pull", label: "Pull", group: "Control", blurb: "Drags a target toward the monster and knocks it prone.", needsDamage: true, needsNotTiny: true },
  { key: "dazzle", label: "Dazzle", group: "Control", blurb: "A flash that can blind nearby creatures.", needsDamage: false, needsNotTiny: false },
  { key: "dread_presence", label: "Dread presence", group: "Control", blurb: "A chilling presence that can frighten creatures nearby.", needsDamage: false, needsNotTiny: false },
  { key: "leap", label: "Leap", group: "Control", blurb: "Springs at a target and can knock it prone.", needsDamage: true, needsNotTiny: true },
  { key: "burst", label: "Burst", group: "Area", blurb: "A recharging burst of the theme's damage all around the monster.", needsDamage: true, needsNotTiny: false },
  { key: "spray", label: "Spray", group: "Area", blurb: "A recharging cone of the theme's damage.", needsDamage: true, needsNotTiny: false },
  { key: "aura", label: "Aura", group: "Area", blurb: "Creatures that start their turn next to the monster take a little damage.", needsDamage: true, needsNotTiny: false },
  { key: "death_burst", label: "Death burst", group: "Area", blurb: "When it dies, it explodes in the theme's damage.", needsDamage: true, needsNotTiny: false },
  { key: "backlash", label: "Backlash", group: "Defence and mobility", blurb: "A reaction that hurts a creature that hits the monster in melee.", needsDamage: true, needsNotTiny: false },
  { key: "blink_step", label: "Blink step", group: "Defence and mobility", blurb: "A short teleport as a bonus action.", needsDamage: false, needsNotTiny: false },
  { key: "ward_flicker", label: "Ward flicker", group: "Defence and mobility", blurb: "A reaction that can turn aside a hit.", needsDamage: false, needsNotTiny: false },
];

/** The moves that fit this monster, in menu order. The server checks again; this only keeps unusable ones off the menu. */
export function movesFor(monster: Monster): RemixMove[] {
  const dealsDamage = damageDealtBy(monster).length > 0;
  return REMIX_MOVES.filter((m) => (dealsDamage || !m.needsDamage) && (monster.size !== "tiny" || !m.needsNotTiny));
}
