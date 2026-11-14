import type { StartingEquipment } from "../../frontend/src/systems/dnd5e-2014/packFormat";

// Fixes to the community copy of SRD 5.1, each with its reason: plain typos, and starting equipment the community
// file leaves out (entered from knowledge of the SRD 5.1 class and background text, still to be confirmed against
// the official PDF, like the check table). Anything less certain is to be checked against the PDF before it goes here.
// The raw files stay unchanged; the importer applies these and lists them in the report.

export interface TextCorrection {
  /** The trait whose text is wrong. */
  trait: string;
  wrong: string;
  right: string;
  reason: string;
}

export const TEXT_CORRECTIONS: TextCorrection[] = [
  {
    trait: "high-elf-cantrip",
    wrong: "of your choice form the wizard spell list",
    right: "of your choice from the wizard spell list",
    reason: "Typo in the community file (\"form\" for \"from\").",
  },
  {
    trait: "brave",
    wrong: "advantage on saving throw against",
    right: "advantage on saving throws against",
    reason: "Typo in the community file (\"saving throw\" for \"saving throws\").",
  },
  {
    trait: "relentless-endurance",
    wrong: "1 hit point instead. you cannot",
    right: "1 hit point instead. You cannot",
    reason: "A sentence starting in lower case in the community file.",
  },
];

/** A fix to a class's or background's starting equipment, where the community file leaves something out. */
export interface KitCorrection {
  /** "classes" or "backgrounds", and the entry's id. */
  collection: "classes" | "backgrounds";
  id: string;
  reason: string;
  fix: (kit: StartingEquipment) => StartingEquipment;
}

export const KIT_CORRECTIONS: KitCorrection[] = [
  {
    collection: "classes",
    id: "rogue",
    reason: "The Rogue's \"(a) a shortbow and quiver of 20 arrows\" has no quiver in the community file; it is added.",
    fix: (kit) => ({
      ...kit,
      choices: kit.choices?.map((c) => ({
        ...c,
        options: c.options.map((o) =>
          o.items.some((l) => "item" in l && l.item === "shortbow") && !o.items.some((l) => "item" in l && l.item === "quiver")
            ? { ...o, items: [...o.items.slice(0, 1), { item: "quiver" }, ...o.items.slice(1)] }
            : o,
        ),
      })),
    }),
  },
  {
    collection: "classes",
    id: "ranger",
    reason: "The Ranger's \"a longbow and a quiver of 20 arrows\" has no quiver in the community file; it is added.",
    fix: (kit) => {
      const items = kit.items ?? [];
      const bow = items.findIndex((l) => "item" in l && l.item === "longbow");
      if (bow < 0 || items.some((l) => "item" in l && l.item === "quiver")) return kit;
      return { ...kit, items: [...items.slice(0, bow + 1), { item: "quiver" }, ...items.slice(bow + 1)] };
    },
  },
  {
    collection: "backgrounds",
    id: "acolyte",
    reason:
      "The Acolyte's equipment in the community file has only the holy symbol, common clothes, the pouch and 15 gp. The SRD also gives a " +
      "prayer book or prayer wheel, 5 sticks of incense and vestments. Vestments are an SRD item; the others are not, so they are added " +
      "by name, without weights.",
    fix: (kit) => {
      const items = kit.items ?? [];
      const symbol = items.filter((l) => "any" in l);
      const rest = items.filter((l) => !("any" in l));
      return {
        ...kit,
        items: [...symbol, { name: "Sticks of incense", qty: 5 }, { item: "vestments" }, ...rest],
        choices: [
          ...(kit.choices ?? []),
          { id: "prayer-book-or-prayer-wheel", label: "(a) a prayer book or (b) a prayer wheel", options: [
            { id: "a", items: [{ name: "Prayer book" }] },
            { id: "b", items: [{ name: "Prayer wheel" }] },
          ] },
        ],
      };
    },
  },
];
