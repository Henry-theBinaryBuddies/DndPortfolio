// A tiny made-up game, used only by tests, that plugs into the core as a second system module.
// If the core serves both this and the real rules module, it really is free of any one game.
//
// "Garden": pick a plant, then share the values 3 and 1 between Sun and Water.
// Each plant adds to one of them, and may grant a choice of pot. A plant has a most Water it can stand:
// above that is a rule problem (which a ruling can override).
import type { CharacterDocument } from "../character";
import type { ChoiceSpec } from "../choices";
import { createContentIndex, type ContentIndex, type IndexedPack } from "../content";
import type { Derived, Evaluation, Issue, StepReport } from "../evaluation";
import type { SystemModule } from "../system";

interface Plant {
  id: string;
  name: string;
  bonus: { stat: "sun" | "water"; amount: number };
  maxWater: number;
  pots?: string[];
}

export const toyGardenPack: IndexedPack = {
  id: "garden-basics",
  version: "1.0",
  collections: {
    plants: [
      { id: "cactus", name: "Cactus", bonus: { stat: "sun", amount: 1 }, maxWater: 1, pots: ["terracotta", "stone"] },
      { id: "fern", name: "Fern", bonus: { stat: "water", amount: 1 }, maxWater: 9 },
    ] satisfies Plant[],
  },
};

export const toyGardenContent: ContentIndex = createContentIndex([toyGardenPack]);

export const toyGarden: SystemModule = {
  id: "toy-garden",
  version: 1,
  title: "Garden (test game)",
  packSchema: {
    validate: (pack) =>
      Object.keys(pack.collections)
        .filter((name) => name !== "plants")
        .map((name) => `collections.${name}: the garden has only "plants".`),
  },
  summary: [
    { kind: "tiles", label: "Growth", items: [{ key: "sun", short: "Sun" }, { key: "water", short: "Water" }] },
    { kind: "list", label: "Companions", list: "companions" },
  ],
  initialChoices: () => ({}),
  migrate: (doc) => ({ ...doc, system: { ...doc.system, version: 1 } }),
  describe: (doc, content) => {
    const plant = typeof doc.choices["plant"] === "string" ? content.get("plants", doc.choices["plant"] as string) : undefined;
    return { text: plant ? `${plant.name} garden` : "" };
  },

  evaluate(doc: CharacterDocument, content: ContentIndex): Evaluation {
    const plantRef = typeof doc.choices["plant"] === "string" ? (doc.choices["plant"] as string) : undefined;
    const plant = plantRef ? (content.get("plants", plantRef) as unknown as Plant | undefined) : undefined;

    const seedChoices: ChoiceSpec[] = [
      {
        key: "plant",
        step: "seed",
        label: "Choose a plant",
        kind: "pick-one",
        required: true,
        options: content.list("plants").map((p) => ({ value: p.ref, name: p.name })),
      },
    ];
    if (plant?.pots) {
      seedChoices.push({
        key: `plant.${plantRef}.pot`,
        step: "seed",
        label: "Choose a pot",
        source: plant.name,
        kind: "pick-one",
        required: true,
        options: plant.pots.map((pot) => ({ value: pot, name: pot })),
      });
    }
    const careChoices: ChoiceSpec[] = [
      {
        key: "care",
        step: "care",
        label: "Share 3 and 1 between Sun and Water",
        kind: "assign",
        required: true,
        slots: [{ id: "sun", name: "Sun" }, { id: "water", name: "Water" }],
        values: [3, 1],
      },
    ];

    const allChoices = [...seedChoices, ...careChoices];
    const answered = (spec: ChoiceSpec) => doc.choices[spec.key] !== undefined;
    const steps: StepReport[] = [
      { id: "seed", label: "Seed", status: seedChoices.every(answered) ? "done" : "todo", choices: seedChoices },
      { id: "care", label: "Care", status: careChoices.every(answered) ? "done" : "todo", choices: careChoices },
    ];

    const care = (doc.choices["care"] ?? {}) as Record<string, number>;
    const derived: Record<string, Derived> = {};
    for (const stat of ["sun", "water"] as const) {
      const breakdown = [{ label: "Care", amount: care[stat] ?? 0 }];
      if (plant?.bonus.stat === stat) breakdown.push({ label: plant.name, amount: plant.bonus.amount });
      const value = breakdown.reduce((sum, line) => sum + Number(line.amount), 0);
      derived[stat] = { value, label: stat === "sun" ? "Sun" : "Water", breakdown };
    }

    const issues: Issue[] = [];
    if (plant && Number(derived.water.value) > plant.maxWater) {
      issues.push({
        id: `too-much-water:${plantRef}`,
        severity: "error",
        step: "care",
        key: "care",
        message: `${plant.name} can stand at most ${plant.maxWater} Water (it would have ${derived.water.value}).`,
        overridable: true,
      });
    }

    const offered = new Set(allChoices.map((c) => c.key));
    const unused = Object.keys(doc.choices).filter((key) => !offered.has(key));
    const lists = { companions: plant ? [{ name: `Pot: ${String(doc.choices[`plant.${plantRef}.pot`] ?? "none")}`, source: plant.name }] : [] };
    return { steps, derived, lists, issues, unused };
  },
};
