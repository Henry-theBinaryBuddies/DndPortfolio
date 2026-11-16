// The Equipment step: take your class's and background's packages, or buy gear with starting gold; then choose
// what to wear. Everything carried goes in the inventory, with equipment packs opened into their contents.
//
//   equipment.method                                  "packages" | "gold"
//   equipment.class.srd-5.1:fighter.armor             "a"                   a lettered choice in the class's package
//   equipment.class.srd-5.1:fighter.weapon.a.0.1      "srd-5.1:longsword"   a pick for "a martial weapon": line 0 of option a, pick 1 of 2
//   equipment.class.srd-5.1:cleric.items.1            "srd-5.1:amulet"      a pick for a fixed line ("a holy symbol")
//   equipment.background.srd-5.1:acolyte.items.0      ...                   the same for the background
//   equipment.wealth                                  (no value: the roll is in the roll log) the class's starting-wealth dice
//   equipment.gold                                    120                   gold pieces from the DM, when there are no dice
//   equipment.shop                                    { "srd-5.1:longsword": 1 }   what was bought, by item
//   equipment.armor                                   "srd-5.1:chain-mail" | "none"
//   equipment.shield                                  "shield" | "none"
//
// Starting gold replaces both packages, as in the rules.
import { rollSets, type ChoiceValue, type Option } from "../../../core";
import { fullRef, picksOf, type Context } from "../engine/context";
import type { Origin } from "../engine/tally";
import type { Background, Class, EquipmentLine, Item, StartingEquipment } from "../packFormat";
import { COINS, type Coin } from "../vocabulary";
import { BACKGROUND_KEY } from "./background";
import { CLASS_KEY } from "./class";

export const EQUIPMENT_STEP = { id: "equipment", label: "Equipment" };
export const METHOD_KEY = "equipment.method";
export const WEALTH_KEY = "equipment.wealth";
export const GOLD_KEY = "equipment.gold";
export const SHOP_KEY = "equipment.shop";
export const ARMOR_KEY = "equipment.armor";
export const SHIELD_KEY = "equipment.shield";
const STEP = EQUIPMENT_STEP.id;

const METHODS: Option[] = [
  { value: "packages", name: "Class & background packages" },
  { value: "gold", name: "Starting gold" },
];

type ItemEntry = Item & { ref: string; pack: string };

export const toCp = (c: { amount: number; unit: Coin }) => Math.round(c.amount * COINS[c.unit]);

/** "AC 16", "AC 11 + Dex", "AC 14 + Dex (max 2)", "+2 AC". */
function armorText(a: NonNullable<Item["armor"]>): string {
  if (a.class === "shield") return `+${a.base} AC`;
  const dex = a.dex === "full" ? " + Dex" : a.dex === "none" ? "" : ` + Dex (max ${a.dex.max})`;
  return `AC ${a.base}${dex}`;
}

/** Chips for an item: what it does, then its price. */
function itemTags(item: Item): string[] {
  const tags: string[] = [];
  if (item.weapon) tags.push(item.weapon.damage ? `${item.weapon.damage.dice} ${item.weapon.damage.type}` : "No damage");
  if (item.armor) tags.push(armorText(item.armor));
  if (item.cost) tags.push(`${item.cost.amount} ${item.cost.unit}`);
  return tags;
}

const itemOption = (item: ItemEntry): Option => ({
  value: item.ref,
  name: item.bundle ? `${item.name} (${item.bundle})` : item.name,
  summary: item.summary,
  description: item.description,
  tags: itemTags(item),
});

/** A line as the book reads it: "Arrow × 20", "a martial weapon", "Vestments". */
function lineText(ctx: Context, line: EquipmentLine, pack: string): string {
  const times = (name: string, qty?: number) => (qty && qty > 1 ? `${name} × ${qty}` : name);
  if ("item" in line) return times(ctx.content.get("items", fullRef(line.item, pack))?.name ?? line.item, line.qty);
  if ("name" in line) return times(line.name, line.qty);
  return times(line.label, line.qty);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The step's working state: the inventory goes straight into the tally. */
class Kit {
  constructor(private ctx: Context) {}

  /** Adds an item, opening an equipment pack into its contents. A reference to an item no pack has is reported. */
  add(ref: string, qty: number, from: Origin): void {
    const item = this.ctx.content.get("items", ref) as ItemEntry | undefined;
    if (!item) {
      this.ctx.issues.push({
        id: `missing-item:${ref}`, severity: "error", step: STEP, overridable: false,
        message: `${from.name} gives "${ref}", which is not in any loaded pack.`,
      });
      return;
    }
    if (item.contents?.length) {
      for (const c of item.contents) this.push(fullRef(c.item, item.pack), c.qty * qty, from, item.name);
    } else {
      this.push(ref, qty, from);
    }
  }

  private push(ref: string, qty: number, from: Origin, inPack?: string): void {
    const item = this.ctx.content.get("items", ref) as ItemEntry | undefined;
    if (!item) return;
    this.ctx.tally.items.push({ ref, name: item.name, qty, weight: (item.weight ?? 0) / (item.bundle ?? 1), from, ...(inPack ? { in: inPack } : {}) });
  }

  /** Takes lines of starting equipment; a line of "any" item opens a pick (one per item wanted) keyed under `keyBase`. */
  lines(lines: EquipmentLine[], keyBase: string, from: Origin, pack: string): void {
    lines.forEach((line, i) => {
      if ("item" in line) return this.add(fullRef(line.item, pack), line.qty ?? 1, from);
      if ("name" in line) {
        this.ctx.tally.items.push({ name: line.name, qty: line.qty ?? 1, weight: line.weight ?? 0, from });
        return;
      }
      const wanted = line.qty ?? 1;
      const options = (this.ctx.content.list("items") as unknown as ItemEntry[])
        .filter((e) => line.any.categories.every((c) => e.categories?.includes(c)))
        .map(itemOption);
      for (let n = 1; n <= wanted; n++) {
        const key = wanted > 1 ? `${keyBase}.${i}.${n}` : `${keyBase}.${i}`;
        const picks = picksOf(this.ctx.doc.choices[key]);
        this.ctx.open.push({
          spec: {
            key, step: STEP, label: `Choose ${line.label}${wanted > 1 ? ` (${n} of ${wanted})` : ""}`, source: from.name, kind: "pick-one",
            required: true, options,
          },
          picks,
          collection: "items",
        });
        if (picks[0] && options.some((o) => o.value === picks[0])) this.add(picks[0], 1, { ...from, choice: key });
      }
    });
  }

  /** A class's or background's package: fixed lines, lettered choices, and gold. */
  package(kit: StartingEquipment, keyBase: string, name: string, pack: string): void {
    const from: Origin = { name, step: STEP };
    this.lines(kit.items ?? [], `${keyBase}.items`, from, pack);
    for (const choice of kit.choices ?? []) {
      const key = `${keyBase}.${choice.id}`;
      const picks = picksOf(this.ctx.doc.choices[key]);
      this.ctx.open.push({
        spec: {
          key, step: STEP, label: choice.label, source: name, kind: "pick-one", required: true,
          // "+" between items, as SRD names have commas of their own ("Crossbow, light").
          options: choice.options.map((o) => ({ value: o.id, name: capital(o.items.map((l) => lineText(this.ctx, l, pack)).join(" + ")) })),
        },
        picks,
      });
      const option = choice.options.find((o) => o.id === picks[0]);
      if (option) this.lines(option.items, `${key}.${option.id}`, { ...from, choice: key }, pack);
    }
    if (kit.gold) this.ctx.tally.coins.push({ cp: toCp(kit.gold), label: name });
  }
}

/** The stored shop: item reference → how many bought (whole numbers above 0). Null if malformed. */
function readShop(value: ChoiceValue | undefined): Record<string, number> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [ref, qty] of Object.entries(value)) {
    if (!Number.isInteger(qty) || (qty as number) < 0) return null;
    if ((qty as number) > 0) out[ref] = qty as number;
  }
  return out;
}

export function equipmentStep(ctx: Context): void {
  ctx.steps.push(EQUIPMENT_STEP);
  const { doc, content } = ctx;
  const method = picksOf(doc.choices[METHOD_KEY])[0];
  ctx.open.push({
    spec: { key: METHOD_KEY, step: STEP, label: "How will you equip?", kind: "pick-one", presentation: "segmented", required: true, options: METHODS },
    picks: method ? [method] : [],
  });

  const classRef = picksOf(doc.choices[CLASS_KEY])[0];
  const cls = classRef ? (content.get("classes", classRef) as unknown as (Class & { ref: string; pack: string }) | undefined) : undefined;
  const bgRef = picksOf(doc.choices[BACKGROUND_KEY])[0];
  const bg = bgRef ? (content.get("backgrounds", bgRef) as unknown as (Background & { ref: string; pack: string }) | undefined) : undefined;
  const kit = new Kit(ctx);
  const note = (id: string, message: string) => ctx.issues.push({ id, severity: "warning", step: STEP, overridable: false, message });

  if (method === "packages") {
    if (!cls || !bg) note("equipment-needs-choices", `Choose ${!cls && !bg ? "a class and a background" : !cls ? "a class" : "a background"} first: ${!cls && !bg ? "their packages appear" : "its package appears"} here.`);
    if (cls?.startingEquipment) kit.package(cls.startingEquipment, `equipment.class.${cls.ref}`, cls.name, cls.pack);
    if (bg?.startingEquipment) kit.package(bg.startingEquipment, `equipment.background.${bg.ref}`, bg.name, bg.pack);
  } else if (method === "gold") {
    let gold = 0;
    if (cls?.startingWealth) {
      const latest = rollSets(doc, WEALTH_KEY).at(-1)?.[0];
      ctx.open.push({
        spec: {
          key: WEALTH_KEY, step: STEP, label: `Roll your starting gold: ${cls.startingWealth.replace("x", " × ")} gp`, source: cls.name,
          kind: "roll", dice: cls.startingWealth, times: 1, required: true,
        },
        picks: [],
        answered: latest !== undefined,
      });
      if (latest) {
        gold = latest.total * COINS.gp;
        ctx.tally.coins.push({ cp: gold, label: `Rolled (${cls.startingWealth.replace("x", " × ")})` });
      }
    } else {
      const value = doc.choices[GOLD_KEY];
      const valid = typeof value === "number" && Number.isFinite(value) && value >= 0;
      ctx.open.push({
        spec: {
          key: GOLD_KEY, step: STEP, label: "Starting gold (gp)", kind: "number", required: true, range: { min: 0, max: 100000 },
          hint: cls ? `The loaded packs give no starting-wealth dice for the ${cls.name}: enter the gold your DM gives you.` : "Enter the gold your DM gives you.",
        },
        picks: [],
        answered: valid,
      });
      if (value !== undefined && value !== null && !valid) {
        ctx.issues.push({ id: "bad-gold", severity: "error", step: STEP, key: GOLD_KEY, overridable: false, message: "Starting gold is a number of gold pieces, 0 or more." });
      }
      if (valid) {
        gold = Math.round(value * COINS.gp);
        ctx.tally.coins.push({ cp: gold, label: "Starting gold" });
      }
    }

    // The shop: every item with a price.
    const forSale = (content.list("items") as unknown as ItemEntry[]).filter((i) => i.cost).sort((a, b) => a.name.localeCompare(b.name));
    const shop = readShop(doc.choices[SHOP_KEY]);
    ctx.open.push({
      spec: {
        key: SHOP_KEY, step: STEP, label: "Buy your equipment", kind: "quantities", required: false, options: forSale.map(itemOption),
        budget: { total: gold, cost: Object.fromEntries(forSale.map((i) => [i.ref, toCp(i.cost!)])), format: "coins" },
      },
      picks: [],
      answered: shop !== null && Object.keys(shop).length > 0,
    });
    if (shop === null) {
      ctx.issues.push({ id: "bad-shop", severity: "error", step: STEP, key: SHOP_KEY, overridable: false, message: "The shopping list must give whole numbers of each item." });
    } else {
      let spent = 0;
      for (const [ref, qty] of Object.entries(shop)) {
        const item = forSale.find((i) => i.ref === ref);
        if (!item) {
          ctx.issues.push({
            id: `invalid-pick:${SHOP_KEY}:${ref}`, severity: "error", step: STEP, key: SHOP_KEY, overridable: false,
            message: `Bought "${ref}", which no loaded pack sells.`,
          });
          continue;
        }
        spent += toCp(item.cost!) * qty;
        kit.add(ref, qty * (item.bundle ?? 1), { name: "Bought", step: STEP, choice: SHOP_KEY });
      }
      if (spent) ctx.tally.coins.push({ cp: -spent, label: "Spent" });
      if (spent > gold) {
        ctx.issues.push({
          id: "overspent", severity: "error", step: STEP, key: SHOP_KEY, overridable: true,
          message: `This costs more than your starting gold (${coinText(spent)} of ${coinText(gold)}).`,
        });
      }
    }
  }

  wear(ctx);
}

/** What to wear, from the armour and shields carried; and the weapons carried, for attacks. */
function wear(ctx: Context): void {
  const carried = new Map<string, ItemEntry>();
  for (const i of ctx.tally.items) {
    const item = i.ref ? (ctx.content.get("items", i.ref) as ItemEntry | undefined) : undefined;
    if (item) carried.set(item.ref, item);
  }
  const all = [...carried.values()];
  const armour = all.filter((i) => i.armor && i.armor.class !== "shield");
  const shields = all.filter((i) => i.armor?.class === "shield");

  if (armour.length) {
    const picks = picksOf(ctx.doc.choices[ARMOR_KEY]);
    ctx.open.push({
      spec: {
        key: ARMOR_KEY, step: STEP, label: "What armour do you wear?", kind: "pick-one", required: true,
        options: [
          { value: "none", name: "No armour", tags: ["Unarmoured"] },
          ...armour.map((a) => ({
            value: a.ref, name: a.name,
            tags: [armorText(a.armor!), ...(a.armor!.strength ? [`Needs Str ${a.armor!.strength}`] : []), ...(a.armor!.stealthDisadvantage ? ["Stealth disadvantage"] : [])],
          })),
        ],
      },
      picks,
    });
    const worn = armour.find((a) => a.ref === picks[0]);
    if (worn) ctx.tally.worn.armor = { ref: worn.ref, name: worn.name, armor: worn.armor! };
  }
  if (shields.length) {
    const picks = picksOf(ctx.doc.choices[SHIELD_KEY]);
    ctx.open.push({
      spec: {
        key: SHIELD_KEY, step: STEP, label: "Do you carry a shield?", kind: "pick-one", presentation: "segmented", required: true,
        options: [{ value: "shield", name: `Carry ${shields[0].name.toLowerCase() === "shield" ? "a shield" : shields[0].name}` }, { value: "none", name: "No shield" }],
      },
      picks,
    });
    if (picks[0] === "shield") ctx.tally.worn.shield = { ref: shields[0].ref, name: shields[0].name, bonus: shields[0].armor!.base };
  }
  for (const w of all) if (w.weapon) ctx.tally.weapons.push({ ref: w.ref, name: w.name, weapon: w.weapon });
}

/** "14 gp 5 sp": copper pieces in gold, silver and copper (the app has its own copy for display). */
export function coinText(cp: number): string {
  const sign = cp < 0 ? "−" : "";
  let left = Math.abs(cp);
  const parts: string[] = [];
  for (const [unit, size] of [["gp", 100], ["sp", 10], ["cp", 1]] as const) {
    const n = Math.floor(left / size);
    left -= n * size;
    if (n) parts.push(`${n} ${unit}`);
  }
  return sign + (parts.join(" ") || "0 gp");
}

/** Once the scores are known: armour you aren't trained in, heavy armour without the Strength, and too much to carry. */
export function checkEquipment(ctx: Context, scores: Record<"str", number>): void {
  const { armor, shield } = ctx.tally.worn;
  const trained = (id: string) => ctx.tally.proficiencies.some((p) => p.kind === "armor" && p.id === id && !p.replaced);
  const warn = (id: string, key: string, message: string) => ctx.issues.push({ id, severity: "warning", step: STEP, key, overridable: true, message });
  const untrained = "disadvantage on any ability check, saving throw or attack roll that uses Strength or Dexterity, and no spellcasting";
  if (armor && !trained(armor.armor.class)) warn(`armor-untrained:${armor.ref}`, ARMOR_KEY, `You aren't proficient with ${armor.armor.class} armour, so ${armor.name} gives you ${untrained}.`);
  if (shield && !trained("shield")) warn(`shield-untrained:${shield.ref}`, SHIELD_KEY, `You aren't proficient with shields, so carrying one gives you ${untrained}.`);
  const needs = armor?.armor.strength;
  if (armor && needs && scores.str < needs) warn(`armor-strength:${armor.ref}`, ARMOR_KEY, `${armor.name} needs Strength ${needs} (yours is ${scores.str}): your speed drops by 10 feet.`);
  const carried = ctx.tally.items.reduce((total, i) => total + i.weight * i.qty, 0);
  if (carried > scores.str * 15) {
    ctx.issues.push({
      id: "over-capacity", severity: "warning", step: STEP, overridable: true,
      message: `You carry ${Math.round(carried * 100) / 100} lb, more than your carrying capacity of ${scores.str * 15} lb (Strength × 15).`,
    });
  }
}
