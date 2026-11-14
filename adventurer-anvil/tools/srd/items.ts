// Turns the 5e-bits SRD 5.1 equipment into the 2014 item format, and a class's or background's starting equipment
// into a package. Pure: data in, entries out. Magic items are not imported yet.
import type { EquipmentLine, Item, StartingEquipment } from "../../frontend/src/systems/dnd5e-2014/packFormat";
import type { DAMAGE_TYPES } from "../../frontend/src/systems/dnd5e-2014/vocabulary";
import type { RawEquipment, RawEquipmentChoice, RawEquipmentOption, RawRef, RawStartingEquipment } from "./raw";

export function buildItems(raw: RawEquipment[]): Item[] {
  return raw.map((e) => {
    const text = [...(e.desc ?? []), ...(e.special ?? [])].join("\n\n");
    const item: Item = {
      id: e.index,
      name: e.name,
      ...(text ? { description: text } : {}),
      categories: e.equipment_categories.map((c) => c.index),
      // A price of 0 marks things that only come in an equipment pack (a priest's alms box): not sold on their own.
      ...(e.cost && e.cost.quantity > 0 ? { cost: { amount: e.cost.quantity, unit: e.cost.unit } } : {}),
      ...(e.weight !== undefined ? { weight: e.weight } : {}),
      ...(e.quantity && e.quantity > 1 ? { bundle: e.quantity } : {}),
    };
    if (e.weapon_category) {
      // A thrown melee weapon's range is its throwing range; a ranged weapon's is its own.
      const range = e.throw_range ?? (e.weapon_range === "Ranged" ? e.range : undefined);
      item.weapon = {
        class: e.weapon_category === "Simple" ? "simple" : "martial",
        range: e.weapon_range === "Ranged" ? "ranged" : "melee",
        ...(e.damage ? { damage: { dice: e.damage.damage_dice, type: e.damage.damage_type.index as (typeof DAMAGE_TYPES)[number] } } : {}),
        ...(e.two_handed_damage ? { versatile: e.two_handed_damage.damage_dice } : {}),
        properties: (e.properties ?? []).map((p) => p.index as NonNullable<Item["weapon"]>["properties"][number]),
        ...(range ? { normal: range.normal, ...(range.long ? { long: range.long } : {}) } : {}),
      };
    }
    if (e.armor_category && e.armor_class) {
      const ac = e.armor_class;
      item.armor = {
        class: e.armor_category.toLowerCase() as NonNullable<Item["armor"]>["class"],
        base: ac.base,
        dex: !ac.dex_bonus ? "none" : ac.max_bonus !== undefined ? { max: ac.max_bonus } : "full",
        ...(e.str_minimum ? { strength: e.str_minimum } : {}),
        ...(e.stealth_disadvantage ? { stealthDisadvantage: true } : {}),
      };
    }
    if (e.contents) item.contents = e.contents.map((c) => ({ item: c.item.index, qty: c.quantity }));
    return item;
  });
}

/** How the book names one item of a category, for "any" lines: "a martial weapon", "an arcane focus". */
const CATEGORY_LABELS: Record<string, string> = {
  "simple-weapons": "a simple weapon",
  "martial-weapons": "a martial weapon",
  "simple-melee-weapons": "a simple melee weapon",
  "martial-melee-weapons": "a martial melee weapon",
  "musical-instruments": "a musical instrument",
  "holy-symbols": "a holy symbol",
  "druidic-foci": "a druidic focus",
  "arcane-foci": "an arcane focus",
};

function anyLine(category: RawRef, choose: number): EquipmentLine {
  const label = CATEGORY_LABELS[category.index];
  if (!label) throw new Error(`No label for "any" item of the category "${category.index}": add it to CATEGORY_LABELS.`);
  return { any: { categories: [category.index] }, ...(choose > 1 ? { qty: choose } : {}), label };
}

function optionLines(o: RawEquipmentOption): EquipmentLine[] {
  if (o.option_type === "counted_reference") return [{ item: o.of.index, ...(o.count > 1 ? { qty: o.count } : {}) }];
  if (o.option_type === "multiple") return o.items.flatMap(optionLines);
  if (o.choice.from.option_set_type !== "equipment_category") throw new Error(`A nested choice of options ("${o.choice.desc}") is not supported.`);
  return [anyLine(o.choice.from.equipment_category, o.choice.choose)];
}

/**
 * A choice's id, from what its options start with: "chain-mail-or-leather-armor". Where two options start alike
 * (a martial weapon and a shield, or two martial weapons), each is named by all its lines: "martial-weapons-and-shield-or-martial-weapons".
 */
function choiceId(options: EquipmentLine[][]): string {
  const lineId = (l: EquipmentLine) => ("item" in l ? l.item : "name" in l ? l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : l.any.categories[0]);
  const firsts = options.map((lines) => lineId(lines[0]));
  if (new Set(firsts).size === firsts.length) return firsts.join("-or-");
  return options.map((lines) => lines.map(lineId).join("-and-")).join("-or-");
}

const LETTERS = "abcdefgh";

/** A class's or background's starting equipment as a package. Plain categories ("a holy symbol") become fixed "any" lines. */
export function kitFrom(raw: RawStartingEquipment, gold?: { quantity: number; unit: "cp" | "sp" | "gp" }): StartingEquipment {
  const items: EquipmentLine[] = raw.starting_equipment.map((s) => ({ item: s.equipment.index, ...(s.quantity > 1 ? { qty: s.quantity } : {}) }));
  const choices: NonNullable<StartingEquipment["choices"]> = [];
  for (const c of raw.starting_equipment_options as RawEquipmentChoice[]) {
    if (c.from.option_set_type === "equipment_category") {
      items.push(anyLine(c.from.equipment_category, c.choose));
      continue;
    }
    if (c.choose !== 1) throw new Error(`"${c.desc}": choosing ${c.choose} of a set of options is not supported.`);
    const options = c.from.options.map(optionLines);
    choices.push({
      id: choiceId(options),
      label: (c.desc ?? "").replace(/’/g, "'"),
      options: options.map((lines, i) => ({ id: LETTERS[i], items: lines })),
    });
  }
  return {
    ...(items.length ? { items } : {}),
    ...(choices.length ? { choices } : {}),
    ...(gold ? { gold: { amount: gold.quantity, unit: gold.unit } } : {}),
  };
}
