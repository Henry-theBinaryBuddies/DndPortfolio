// Turns the 5e-bits SRD 5.1 class files into the 2014 format's classes and subclasses. Pure: data in, entries and
// notes out. Every feature of levels 1 to 20 is brought in. Those that need calculating or choosing are typed here
// (resources, Ability Score Improvements, choices such as Eldritch Invocations); the rest are kept as text.
import type { Class, Effect, Subclass } from "../../frontend/src/systems/dnd5e-2014/packFormat";
import type { Ability } from "../../frontend/src/systems/dnd5e-2014/vocabulary";
import { kitFrom } from "./items";
import { spellcastingFor } from "./spells";
import type { RawChoice, RawClass, RawFeature, RawLevel, RawOption, RawRef, RawSrdClasses, RawSubclass } from "./raw";

/** What a written-in option can give: any effect but one that opens a choice. */
type SimpleEffect = Exclude<Effect, { type: "choice" | "ability-score-improvement" }>;

export type FeatureHow = "calculated" | "calculated, with text" | "choice" | "text";
export interface FeatureNote {
  feature: string;
  name: string;
  className: string;
  level: number;
  how: FeatureHow;
  note?: string;
}

/** One line per class, in our own words: the SRD has no class summaries. */
const SUMMARIES: Record<string, string> = {
  barbarian: "A fierce warrior who fights in a battle rage.",
  bard: "A performer whose words and music carry magic.",
  cleric: "A priest who wields divine magic in a god's service.",
  druid: "A keeper of the old faith who draws on nature's power.",
  fighter: "A master of weapons, armour and battle.",
  monk: "A martial artist who channels inner power through the body.",
  paladin: "A holy warrior bound by a sacred oath.",
  ranger: "A hunter and tracker of the wild frontiers.",
  rogue: "A scoundrel who relies on stealth, skill and precision.",
  sorcerer: "A spellcaster with magic in the blood.",
  warlock: "A wielder of magic granted by a pact with a powerful being.",
  wizard: "A scholar of magic who learns spells from books.",
};

/** Readable names for class table columns, where the 5e-bits key isn't one. */
const COLUMN_NAMES: Record<string, string> = {
  "rage-count": "Rages", "rage-damage-bonus": "Rage Damage", "brutal-critical-dice": "Brutal Critical dice",
  "bardic-inspiration-die": "Bardic Inspiration die", "song-of-rest-die": "Song of Rest die",
  "channel-divinity-charges": "Channel Divinity", "destroy-undead-cr": "Destroy Undead (CR)",
  "wild-shape-max-cr": "Wild Shape (max CR)", "wild-shape-swim": "Wild Shape: swimming", "wild-shape-fly": "Wild Shape: flying",
  "action-surges": "Action Surges", "indomitable-uses": "Indomitable", "extra-attacks": "Extra Attacks",
  "martial-arts": "Martial Arts", "ki-points": "Ki Points", "unarmored-movement": "Unarmored Movement (ft)",
  "aura-range": "Aura range (ft)", "favored-enemies": "Favored Enemies", "favored-terrain": "Favored Terrain",
  "sneak-attack": "Sneak Attack", "sorcery-points": "Sorcery Points", "metamagic-known": "Metamagic known",
  "invocations-known": "Invocations known", "arcane-recovery-levels": "Arcane Recovery (spell levels)",
  "cantrips-known": "Cantrips Known", "spells-known": "Spells Known",
  ...Object.fromEntries(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"].map((n, i) => [`spell-slots-level-${i + 1}`, `${n}-level slots`])),
};

const WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
const word = (n: number) => WORDS[n] ?? String(n);
const kebab = (s: string) => s.replace(/_/g, "-").replace(/-+/g, "-");
const titleCase = (s: string) => s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** The SRD equipment ids that items will use: "longswords" → "longsword", "crossbows-light" → "crossbow-light". */
const WEAPON_IDS: Record<string, string> = { "crossbows-light": "crossbow-light", "crossbows-heavy": "crossbow-heavy", "hand-crossbows": "crossbow-hand" };

export function buildClasses(raw: RawSrdClasses) {
  const notes: FeatureNote[] = [];
  const features = new Map(raw.features.map((f) => [f.index, f]));
  const profType = new Map(raw.proficiencies.map((p) => [p.index, p]));
  const text = (f: RawFeature) => f.desc.join("\n\n");
  const feature = (f: RawFeature): Effect => ({ type: "feature", name: f.name, description: text(f) });

  /** A 5e-bits proficiency as effects: saves, skills, armour (all armour is three), weapons and tools. */
  function proficiencyEffects(index: string): SimpleEffect[] {
    if (index.startsWith("saving-throw-")) return [{ type: "proficiency", kind: "saving-throw", id: index.slice(13) }];
    if (index.startsWith("skill-")) return [{ type: "proficiency", kind: "skill", id: index.slice(6) }];
    const type = profType.get(index)?.type;
    if (!type) throw new Error(`Unknown proficiency "${index}".`);
    if (type === "Armor") {
      if (index === "all-armor") return ["light", "medium", "heavy"].map((id) => ({ type: "proficiency", kind: "armor", id }));
      if (index === "shields") return [{ type: "proficiency", kind: "armor", id: "shield" }];
      return [{ type: "proficiency", kind: "armor", id: index.replace(/-armor$/, "") }];
    }
    if (type === "Weapons") {
      if (index === "simple-weapons" || index === "martial-weapons") return [{ type: "proficiency", kind: "weapon", id: index.replace(/-weapons$/, "") }];
      return [{ type: "proficiency", kind: "weapon", id: WEAPON_IDS[index] ?? index.replace(/s$/, "") }];
    }
    return [{ type: "proficiency", kind: "tool", id: index }];
  }

  /** The references in an option set, with nested choices flattened (a monk's "artisan's tools or an instrument"). */
  const refsIn = (c: RawChoice): RawRef[] => c.from.options.flatMap(refsOf);
  const refsOf = (o: RawOption): RawRef[] =>
    typeof o === "string" ? []
    : o.option_type === "reference" ? [o.item]
    : o.option_type === "choice" ? refsIn(o.choice)
    : o.option_type === "multiple" ? o.items.flatMap(refsOf)
    : [];

  /** A proficiency choice: skills from the fixed list, anything else as written-in options. */
  function proficiencyChoice(c: RawChoice, prefix = ""): Effect {
    const refs = refsIn(c);
    if (refs.every((r) => r.index.startsWith("skill-"))) {
      return {
        type: "choice", id: `${prefix}skills`, label: `Choose ${word(c.choose)} skill${c.choose > 1 ? "s" : ""}`, pick: c.choose,
        from: { list: "skills", only: refs.map((r) => r.index.slice(6)) }, each: { type: "proficiency", kind: "skill" },
      };
    }
    const instruments = refs.every((r) => profType.get(r.index)?.type === "Musical Instruments");
    return {
      type: "choice", id: `${prefix}${instruments ? "instruments" : "tools"}`,
      label: instruments ? `Choose ${word(c.choose)} musical instrument${c.choose > 1 ? "s" : ""}` : `Choose ${word(c.choose)}: artisan's tools or a musical instrument`,
      pick: c.choose,
      from: { options: refs.map((r) => ({ id: r.index, name: profType.get(r.index)!.name, effects: proficiencyEffects(r.index) })) },
    };
  }

  // ---- Features ----

  /** Effects typed by hand for the written-in options of a choice (fighting styles, dragon ancestors). */
  function optionEffects(f: RawFeature): SimpleEffect[] {
    if (/fighting-style-defense$/.test(f.index)) return [{ type: "armor-class-bonus", amount: 1, while: "armored" }];
    return [];
  }

  /** The id of each option: its index without what every option's index starts with ("fighter-fighting-style-"). */
  function optionIds(indexes: string[]): string[] {
    const parts = indexes.map((i) => i.replace(/-+/g, "-").split("-"));
    let common = 0;
    while (indexes.length > 1 && parts.every((p) => p.length > common + 1 && p[common] === parts[0][common])) common++;
    return parts.map((p) => p.slice(common).join("-"));
  }

  /** A feature's choice id: its index without the class's name ("fighter-fighting-style" → "fighting-style"). */
  const choiceId = (f: RawFeature, classIndex: string) => kebab(f.index.startsWith(`${classIndex}-`) ? f.index.slice(classIndex.length + 1) : f.index);

  /** Each feature offered as an option, by index → its choice's id and its option id ("pact-of-the-blade" → pact-boon, blade). */
  const offeredAs = new Map<string, { choice: string; id: string }>();
  for (const f of raw.features) {
    const c = f.feature_specific?.subfeature_options;
    if (!c) continue;
    const refs = refsIn(c);
    optionIds(refs.map((r) => r.index)).forEach((id, i) => offeredAs.set(refs[i].index, { choice: choiceId(f, f.class.index), id }));
  }

  /** The spells an Eldritch Invocation lets a warlock cast (at will, or once per long rest with a warlock slot). */
  const INVOCATION_SPELLS: Record<string, string> = {
    "armor-of-shadows": "mage-armor", "beast-speech": "speak-with-animals", "eldritch-sight": "detect-magic", "fiendish-vigor": "false-life",
    "mask-of-many-faces": "disguise-self", "misty-visions": "silent-image", "thief-of-five-fates": "bane", "mire-the-mind": "slow",
    "sign-of-ill-omen": "bestow-curse", "bewitching-whispers": "compulsion", "dreadful-word": "confusion", "sculptor-of-flesh": "polymorph",
    "ascendant-step": "levitate", "minions-of-chaos": "conjure-elemental", "otherworldly-leap": "jump", "whispers-of-the-grave": "speak-with-dead",
    "chains-of-carceri": "hold-monster", "master-of-myriad-forms": "alter-self", "visions-of-distant-realms": "arcane-eye",
  };

  /** Eldritch Invocations: as many as the Invocations Known column says, each with its prerequisites and what it gives. */
  function invocations(f: RawFeature): Effect {
    const refs = f.feature_specific!.invocations!;
    return {
      type: "choice", id: "eldritch-invocations", label: "Eldritch Invocations", pick: { column: "invocations-known" },
      from: {
        options: refs.map((r) => {
          const inv = features.get(r.index);
          if (!inv) throw new Error(`Eldritch Invocations offers "${r.index}", which is not in the file.`);
          const id = r.index.replace(/^eldritch-invocation-/, "");
          const requires: { level?: number; option?: { choice: string; id: string }; spell?: string } = {};
          for (const p of inv.prerequisites ?? []) {
            if (p.type === "level" && p.level) requires.level = p.level;
            else if (p.type === "spell" && p.spell) requires.spell = p.spell.split("/").pop()!;
            else if (p.type === "feature" && p.feature) {
              const option = offeredAs.get(p.feature.split("/").pop()!);
              if (!option) throw new Error(`${inv.name} needs "${p.feature}", which no choice offers.`);
              requires.option = option;
            } else throw new Error(`${inv.name}: an unknown prerequisite ${JSON.stringify(p)}.`);
          }
          const effects: SimpleEffect[] =
            id === "beguiling-influence" ? [{ type: "proficiency", kind: "skill", id: "deception" }, { type: "proficiency", kind: "skill", id: "persuasion" }]
            : INVOCATION_SPELLS[id] ? [{ type: "spell", id: INVOCATION_SPELLS[id], ability: "cha" as Ability }]
            : [];
          return {
            id,
            name: inv.name.replace(/^Eldritch Invocation: /, ""),
            description: text(inv),
            ...(Object.keys(requires).length ? { requires } : {}),
            effects,
          };
        }),
      },
    };
  }

  /** Spells from any class: the highest level allowed where each is chosen, and whether they count among spells known. */
  const SECRETS: Record<string, { maxLevel: number; known: boolean }> = {
    "additional-magical-secrets": { maxLevel: 3, known: false }, // the College of Lore's, at bard level 6
    "magical-secrets-1": { maxLevel: 5, known: true },
    "magical-secrets-2": { maxLevel: 7, known: true },
    "magical-secrets-3": { maxLevel: 9, known: true },
  };
  const ORDINAL_WORDS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

  function choiceFor(f: RawFeature, classIndex: string): Effect | undefined {
    const id = choiceId(f, classIndex);
    const fs = f.feature_specific;
    if (fs?.subfeature_options) {
      const c = fs.subfeature_options;
      const refs = refsIn(c);
      const ids = optionIds(refs.map((r) => r.index));
      return {
        type: "choice", id, label: `${f.name}: choose ${word(c.choose)}`, pick: c.choose,
        from: {
          options: refs.map((r, i) => {
            const sub = features.get(r.index);
            if (!sub) throw new Error(`Feature "${f.index}" offers "${r.index}", which is not in the file.`);
            const own = text(sub);
            return {
              id: ids[i],
              name: sub.name.includes(": ") ? sub.name.slice(sub.name.indexOf(": ") + 2) : sub.name,
              ...(own !== text(f) ? { description: own } : {}),
              effects: optionEffects(sub),
            };
          }),
        },
      };
    }
    if (fs?.expertise_options) {
      const c = fs.expertise_options;
      const refs = refsIn(c);
      // A rogue's expertise may always go to thieves' tools (the community file lists only skills at level 6).
      const tools = classIndex === "rogue" || refs.some((r) => r.index === "thieves-tools");
      // Rogue level 1 is written as "two skills, or one skill and thieves' tools": two picks either way.
      const pick = c.from.options.length && typeof c.from.options[0] !== "string" && c.from.options[0].option_type === "choice" ? c.from.options[0].choice.choose : c.choose;
      return {
        type: "choice", id, label: `Expertise: choose ${word(pick)} of your proficiencies`, pick,
        from: { proficient: tools ? ["skill", "tool:thieves-tools"] : ["skill"] }, each: { type: "expertise" },
      };
    }
    if (f.index === "spell-mastery") return undefined; // two choices: see featureEffects
    const arcanum = /^mystic-arcanum-(\d)th-level$/.exec(f.index);
    if (arcanum) {
      const level = Number(arcanum[1]);
      return {
        type: "choice", id: `mystic-arcanum-${level}`, label: `Mystic Arcanum: choose a ${ORDINAL_WORDS[level]}-level warlock spell`, pick: 1,
        from: { collection: "spells", where: { classes: "warlock", level } }, ability: "cha",
      };
    }
    const secrets = SECRETS[f.index];
    if (secrets) {
      return {
        type: "choice", id, label: `${f.name.replace(/ \(.*\)$/, "")}: choose two spells from any class`, pick: 2,
        from: { collection: "spells", where: { level: Array.from({ length: secrets.maxLevel + 1 }, (_, l) => l) }, ...(secrets.known ? { known: true } : {}) },
        ability: "cha",
      };
    }
    const strings = fs?.enemy_type_options ?? fs?.terrain_type_options;
    if (strings) {
      const what = fs?.enemy_type_options ? "type of enemy" : "terrain";
      return {
        type: "choice", id, label: `${f.name.replace(/ \(.*\)$/, "")}: choose a ${what}`, pick: strings.choose,
        from: { options: strings.from.options.filter((o): o is string => typeof o === "string").map((o) => ({ id: o, name: titleCase(o), effects: [] })) },
      };
    }
    return undefined;
  }

  function featureEffects(f: RawFeature, className: string, classIndex: string): Effect[] {
    const note = (how: FeatureHow, why?: string) => notes.push({ feature: f.index, name: f.name, className, level: f.level, how, note: why });
    const res = (uses: Extract<Effect, { type: "resource" }>["uses"], recharge: "short" | "long", name = f.name): Effect =>
      ({ type: "resource", id: kebab(f.index), name, uses, recharge });

    switch (f.index) {
      case "rage":
        note("calculated, with text", "Uses per long rest from the Rages column; its damage bonus is in the class table.");
        return [res({ column: "rage-count" }, "long"), feature(f)];
      case "barbarian-unarmored-defense":
        note("calculated, with text", "AC 10 + Dex + Con without armour; a shield is allowed.");
        return [{ type: "armor-class", base: 10, abilities: ["dex", "con"] }, feature(f)];
      case "monk-unarmored-defense":
        note("calculated, with text", "AC 10 + Dex + Wis without armour or a shield.");
        return [{ type: "armor-class", base: 10, abilities: ["dex", "wis"], shield: false }, feature(f)];
      case "second-wind":
        note("calculated, with text", "1 use per short rest.");
        return [res(1, "short"), feature(f)];
      case "bardic-inspiration-d6":
        note("calculated, with text", "Uses equal your Charisma modifier (at least one) per long rest.");
        return [res({ ability: "cha" as Ability, min: 1 }, "long"), feature(f)];
      case "divine-sense":
        note("calculated, with text", "Uses equal 1 + your Charisma modifier per long rest.");
        return [res({ ability: "cha" as Ability, add: 1 }, "long"), feature(f)];
      case "lay-on-hands":
        note("calculated, with text", "The pool is tracked as hit points: 5 per paladin level, per long rest.");
        return [res({ perLevel: 5 }, "long", "Lay on Hands pool (hit points)"), feature(f)];
      case "bonus-proficiency":
        note("calculated", "Heavy armour.");
        return [{ type: "proficiency", kind: "armor", id: "heavy" }, feature(f)];
      case "draconic-resilience":
        note("calculated, with text", "+1 hit point per level, and AC 13 + Dex without armour.");
        return [{ type: "hit-points", perLevel: 1 }, { type: "armor-class", base: 13, abilities: ["dex"] }, feature(f)];
      case "spell-mastery":
        note("choice", "A 1st-level and a 2nd-level spell from the spellbook, marked there.");
        return [
          { type: "choice", id: "spell-mastery-1", label: "Spell Mastery: choose a 1st-level spell in your spellbook", pick: 1, from: { collection: "spells", where: { classes: "wizard", level: 1 }, spellbook: true }, note: "Spell Mastery" },
          { type: "choice", id: "spell-mastery-2", label: "Spell Mastery: choose a 2nd-level spell in your spellbook", pick: 1, from: { collection: "spells", where: { classes: "wizard", level: 2 }, spellbook: true }, note: "Spell Mastery" },
          feature(f),
        ];
      case "signature-spell":
        note("choice", "Two 3rd-level spells from the spellbook, always prepared.");
        return [
          { type: "choice", id: "signature-spells", label: "Signature Spells: choose two 3rd-level spells in your spellbook", pick: 2, from: { collection: "spells", where: { classes: "wizard", level: 3 }, spellbook: true }, note: "Signature spell", always: true },
          feature(f),
        ];
      case "eldritch-invocations":
        note("choice", "As many as the Invocations Known column says. Prerequisites are checked; skills and spells are given.");
        return [invocations(f), feature(f)];
      case "dragon-ancestor":
        note("choice", "A choice of dragon; also gives Draconic. The damage type is used by later features.");
        return [choiceFor(f, classIndex)!, { type: "language", id: "draconic" }, feature(f)];
    }
    if (/-ability-score-improvement-\d+$/.test(f.index)) {
      note("choice", "+2 to one score or +1 to two, none above 20.");
      return [{ type: "ability-score-improvement", id: `asi-${f.level}` }, feature(f)];
    }
    const choice = choiceFor(f, classIndex);
    if (choice) {
      note("choice");
      return [choice, feature(f)];
    }
    if (/^spellcasting-|^pact-magic$/.test(f.index)) {
      note("calculated, with text", "Cantrips, spells known or prepared, and slots come from the class's spellcasting and table.");
      return [feature(f)];
    }
    if (/^domain-spells-\d$|^oath-spells$/.test(f.index)) {
      note("calculated, with text", "The subclass gives the spells, always prepared, at the levels its table says.");
      return [feature(f)];
    }
    note("text", "Nothing to calculate.");
    return [feature(f)];
  }

  // ---- Levels and columns ----

  const diceText = (d: { dice_count: number; dice_value: number }) => `${d.dice_count}d${d.dice_value}`;

  /** The class table's columns, with a value at the first level and wherever it changes. */
  function columnsFrom(levels: RawLevel[], field: "class_specific" | "subclass_specific" | "spellcasting") {
    const columns = new Map<string, Record<string, number | string>>();
    const last = new Map<string, number | string>();
    for (const l of [...levels].sort((a, b) => a.level - b.level)) {
      for (const [key, v] of Object.entries(l[field] ?? {})) {
        const value =
          typeof v === "number" ? v
          : typeof v === "boolean" ? (v ? "Yes" : "No")
          : v && typeof v === "object" && "dice_count" in v ? diceText(v as unknown as { dice_count: number; dice_value: number })
          : undefined;
        if (value === undefined) continue; // e.g. the sorcerer's spell slot costs, which are a table of their own
        const id = kebab(key);
        if (last.get(id) === value) continue;
        last.set(id, value);
        columns.set(id, { ...(columns.get(id) ?? {}), [String(l.level)]: value });
      }
    }
    return [...columns].map(([id, values]) => ({ id, name: COLUMN_NAMES[id] ?? titleCase(id), values }));
  }

  function levelsFrom(levels: RawLevel[], className: string, classIndex: string) {
    return [...levels]
      .sort((a, b) => a.level - b.level)
      .filter((l) => l.features.length)
      .map((l) => ({
        level: l.level,
        effects: l.features.flatMap((ref) => {
          const f = features.get(ref.index);
          if (!f) throw new Error(`Level ${l.index} lists "${ref.index}", which is not in the features file.`);
          return featureEffects(f, className, classIndex);
        }),
      }));
  }

  // ---- Classes and subclasses ----

  const proficiencyNames = (c: RawClass, kinds: string[]) =>
    c.proficiencies.filter((p) => kinds.includes(profType.get(p.index)?.type ?? "")).map((p) => p.name).join(", ") || "None";

  const classes: Class[] = raw.classes.map((c) => {
    const levels = raw.levels.filter((l) => l.class.index === c.index && !l.subclass);
    const subLevels = raw.levels.filter((l) => l.class.index === c.index && l.subclass);
    const subclass = raw.subclasses.find((s) => s.class.index === c.index);
    const mc = c.multi_classing;
    const prereq = (p: { ability_score: RawRef; minimum_score: number }) => ({ ability: p.ability_score.index as Ability, min: p.minimum_score });
    const anyOf = mc.prerequisite_options?.from.options.filter((o): o is Extract<RawOption, { option_type: "score_prerequisite" }> => typeof o !== "string" && o.option_type === "score_prerequisite");
    const skillChoice = c.proficiency_choices.find((pc) => refsIn(pc).every((r) => r.index.startsWith("skill-")));

    const description = [
      `Hit Dice: 1d${c.hit_die} per ${c.name.toLowerCase()} level`,
      `Hit Points at 1st Level: ${c.hit_die} + your Constitution modifier`,
      `Hit Points at Higher Levels: 1d${c.hit_die} (or ${c.hit_die / 2 + 1}) + your Constitution modifier per ${c.name.toLowerCase()} level after 1st`,
      `Armor: ${proficiencyNames(c, ["Armor"])}`,
      `Weapons: ${proficiencyNames(c, ["Weapons"])}`,
      `Tools: ${proficiencyNames(c, ["Artisan's Tools", "Musical Instruments", "Gaming Sets", "Other", "Vehicles"])}`,
      `Saving Throws: ${c.saving_throws.map((s) => ({ STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" })[s.name] ?? s.name).join(", ")}`,
      ...(skillChoice?.desc ? [`Skills: ${skillChoice.desc}`] : []),
    ].join("\n");

    const columns = [...columnsFrom(levels, "class_specific"), ...columnsFrom(levels, "spellcasting")];
    const spellcasting = spellcastingFor(c, new Set(columns.map((col) => col.id)));
    return {
      id: c.index,
      name: c.name,
      summary: SUMMARIES[c.index],
      description,
      hitDie: c.hit_die as Class["hitDie"],
      proficiencies: [
        ...c.proficiencies.flatMap((p) => proficiencyEffects(p.index)),
        ...c.proficiency_choices.map((pc) => proficiencyChoice(pc)),
      ],
      multiclass: {
        requires: mc.prerequisites ? { all: mc.prerequisites.map(prereq) } : { any: anyOf!.map(prereq) },
        proficiencies: [
          ...mc.proficiencies.flatMap((p) => proficiencyEffects(p.index)),
          ...(mc.proficiency_choices ?? []).map((pc) => proficiencyChoice(pc, "multiclass-")),
        ],
      },
      ...(subclass ? { subclass: { name: subclass.subclass_flavor, level: Math.min(...subLevels.map((l) => l.level)) } } : {}),
      columns,
      levels: levelsFrom(levels, c.name, c.index),
      startingEquipment: kitFrom(c),
      ...(spellcasting ? { spellcasting } : {}),
    };
  });

  const subclasses: Subclass[] = raw.subclasses.map((s) => {
    const levels = raw.levels.filter((l) => l.subclass?.index === s.index);
    const columns = columnsFrom(levels, "subclass_specific");
    return {
      id: s.index,
      name: s.name,
      class: s.class.index,
      description: s.desc.join("\n\n"),
      ...(columns.length ? { columns } : {}),
      levels: withSpells(levelsFrom(levels, `${s.name} (${s.class.name})`, s.class.index), s),
    };
  });

  /**
   * A subclass's spells, added at the levels they come: always prepared (a domain's or an oath's), or added to the
   * class's list (a warlock patron's expanded spells). The Land's depend on the terrain chosen at level 3, so they
   * wait for levelling up.
   */
  function withSpells(levels: { level: number; effects: Effect[] }[], s: RawSubclass) {
    if (s.index === "land") return landLevels(levels, s);
    if (!s.spells?.length) return levels;
    const byLevel = new Map<number, string[]>();
    for (const sp of s.spells) {
      const at = sp.prerequisites.find((p) => p.type === "level");
      if (!at || sp.prerequisites.length > 1) throw new Error(`${s.name}: a spell with prerequisites other than a level.`);
      const level = Number(at.index.split("-").pop());
      byLevel.set(level, [...(byLevel.get(level) ?? []), sp.spell.index]);
    }
    const out = levels.map((l) => ({ ...l, effects: [...l.effects] }));
    for (const [level, ids] of [...byLevel].sort((a, b) => a[0] - b[0])) {
      const effects: Effect[] = s.class.index === "warlock" ? [{ type: "expanded-spells", ids }] : ids.map((id) => ({ type: "spell", id, always: true }));
      const entry = out.find((l) => l.level === level);
      if (entry) entry.effects.push(...effects);
      else out.push({ level, effects });
    }
    return out.sort((a, b) => a.level - b.level);
  }

  /**
   * The Circle of the Land, which the community files leave unfinished: its choice of land and its bonus cantrip at
   * druid level 2 (from the features file), and each land's circle spells, always prepared from the druid level each
   * comes at (3, 5, 7, 9), with the Circle Spells text at those levels.
   */
  function landLevels(levels: { level: number; effects: Effect[] }[], s: RawSubclass) {
    const circle = features.get("circle-of-the-land");
    if (!circle?.feature_specific?.subfeature_options) throw new Error("The Circle of the Land's choice of land is missing from the features file.");
    const refs = refsIn(circle.feature_specific.subfeature_options);
    const ids = optionIds(refs.map((r) => r.index));
    const spellsFor = (land: string): SimpleEffect[] =>
      (s.spells ?? [])
        .filter((sp) => sp.prerequisites.some((p) => p.type === "feature" && p.index === land))
        .map((sp) => {
          const at = sp.prerequisites.find((p) => p.type === "level");
          if (!at) throw new Error(`${sp.spell.name}: a circle spell without a druid level.`);
          return { type: "spell", id: sp.spell.index, always: true, level: Number(at.index.split("-").pop()) };
        });
    const land: Effect = {
      type: "choice", id: "land", label: "Circle of the Land: choose your land", pick: 1,
      from: { options: refs.map((r, i) => ({ id: ids[i], name: features.get(r.index)!.name.replace(/^Circle of the Land: /, ""), effects: spellsFor(r.index) })) },
    };
    const cantrip: Effect = {
      type: "choice", id: "bonus-cantrip", label: "Bonus Cantrip: choose a druid cantrip", pick: 1,
      from: { collection: "spells", where: { classes: "druid", level: 0 } }, ability: "wis",
    };
    notes.push({ feature: "circle-of-the-land", name: "Circle of the Land", className: `${s.name} (${s.class.name})`, level: 2, how: "choice", note: "The land, with its circle spells always prepared from the druid level each comes at." });
    notes.push({ feature: "bonus-cantrip", name: "Bonus Cantrip", className: `${s.name} (${s.class.name})`, level: 2, how: "choice" });
    const out = levels.map((l) => ({ ...l, effects: l.level === 2 ? [land, cantrip, ...l.effects] : [...l.effects] }));
    for (const [n, level] of [[1, 3], [2, 5], [3, 7], [4, 9]] as const) {
      const f = features.get(`circle-spells-${n}`);
      if (!f) throw new Error(`circle-spells-${n} is missing from the features file.`);
      const entry = out.find((l) => l.level === level);
      const effect = feature(f);
      if (entry) entry.effects.push(effect);
      else out.push({ level, effects: [effect] });
    }
    return out.sort((a, b) => a.level - b.level);
  }

  return { classes, subclasses, notes };
}
