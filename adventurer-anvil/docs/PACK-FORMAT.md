# Adventurer Anvil: the content pack format (2014 rules)

A **content pack** is a JSON file of game content: races, classes, spells, items and so on. The app reads it, checks it,
and the rules module applies it. Packs hold **data only**: what a High Elf has, never how a bonus is worked out.

This guide is for anyone writing a pack, starting with your own packs for books you own. The precise definition is the
JSON Schema at [`frontend/public/schemas/dnd5e-2014-pack.schema.json`](../frontend/public/schemas/dnd5e-2014-pack.schema.json),
made from the same code that checks packs, so the two can't disagree. A worked example is
[`examples/my-homebrew.pack.json`](examples/my-homebrew.pack.json); a test loads it, so it stays correct.

## What goes in a pack, and what doesn't

- **Mechanics:** numbers, choices, prerequisites, what each thing gives.
- **Your own words**, or a page reference (`"source": { "book": "PHB", "page": 31 }`), for anything from a book. Don't
  copy a book's rules text into a pack. Openly licensed text, such as SRD 5.1's, may be included in full, with its
  attribution.
- **Private:** from Milestone 2, packs you upload are readable only by your account. A sheet stores the *results*
  (Darkvision 60 ft), so a DM who sees your character never sees your pack.

## The wrapper

```json
{
  "$schema": "../../frontend/public/schemas/dnd5e-2014-pack.schema.json",
  "format": "adventurer-anvil-pack",
  "formatVersion": 1,
  "id": "my-homebrew",
  "version": "0.1.0",
  "system": "dnd5e-2014",
  "title": "My homebrew",
  "attribution": "Optional: the credit the content asks for.",
  "requires": ["srd-5.1"],
  "collections": { "races": [], "feats": [] }
}
```

| Field | Meaning |
|---|---|
| `$schema` | Optional. Point it at the schema and an editor such as VS Code checks the file as you type. |
| `format`, `formatVersion` | Always `"adventurer-anvil-pack"` and `1`. |
| `id` | Lower-case words joined by hyphens or dots, unique among your packs: `my-homebrew`, `phb-2014`. |
| `version` | `major.minor.patch`. Characters remember which version they were made with. |
| `system` | `"dnd5e-2014"`. |
| `requires` | The packs whose entries this one refers to. Usually `["srd-5.1"]`. |
| `collections` | Any of: `races`, `subraces`, `classes`, `subclasses`, `backgrounds`, `feats`, `items`, `spells`, `languages`. |

### Ids and references

Every entry has an `id`: lower-case words joined by hyphens (`high-elf`). Another entry in the **same** pack is referred to
by its id (`"race": "elf"`); one in **another** pack by `pack:id` (`"srd-5.1:common"`), and that pack must be in
`requires`. Characters store references like `srd-5.1:fighter`, so don't rename ids once characters use them.

## Every entry

| Field | Meaning |
|---|---|
| `id`, `name` | Required. |
| `summary` | One line, in your own words. Shown on option cards. |
| `description` | Full text, for openly licensed material. |
| `source` | Where the full text is: `{ "book": "PHB", "page": 24 }`. |

## The collections

### Races and subraces

| Field | Meaning |
|---|---|
| `size` | `"medium"`, or a list to choose from: `["small", "medium"]`. |
| `effects` | What it gives (see [Effects](#effects)). |
| `rule` | `"feats"`: offered only when the character uses the feats rule (a Variant Human). |
| `suggestions` | For the Details step: `ageAdult`, `ageMax`, `height` and `weight` ranges (`{ "min", "max" }` in inches and pounds), and name lists (`names`) or name syllables (`nameParts`). |
| `race` | Subraces only: the race it belongs to. |

### Classes

| Field | Meaning |
|---|---|
| `hitDie` | 6, 8, 10 or 12. |
| `proficiencies` | Effects for taking it as your **first** class: saving throws, armour, weapons, tools, the skill choice. |
| `multiclass` | `requires`: scores to take it later (`{ "all": [...] }` or `{ "any": [...] }`, each `{ "ability": "int", "min": 13 }`); `proficiencies`: the smaller set it gives then. |
| `subclass` | `{ "name": "Martial Archetype", "level": 3 }`. |
| `columns` | The class table: `{ "id": "rage-count", "name": "Rages", "values": { "1": 2, "3": 3 } }`. A value lasts until the next level that gives one. |
| `levels` | `[{ "level": 1, "effects": [...] }, ...]`, rising. Each level's effects apply once the class reaches it. |
| `startingEquipment` | `items` (lines), `choices` (lettered options, each a list of lines) and `gold`. A line is `{ "item": "longsword" }`, `{ "any": { "categories": ["martial-weapons"] }, "label": "a martial weapon" }`, or `{ "name": "vestments" }`. |
| `startingWealth` | Dice for gold instead of equipment: `"5d4x10"`. |
| `spellcasting` | See below. |

**Spellcasting:** `ability`; `level` it starts at; `kind` (`known`, `prepared`, `spellbook` or `pact`); `progression`
for multiclass slots (`full`, `half`, `third` or `pact`); the class table columns for `cantrips`, `known` and `slots`
(`{ "1": "spell-slots-level-1" }`); `prepare` (`level` or `half-level`); `spellbook` (`{ "start": 6, "perLevel": 2 }`);
`list` (whose spell list, if not its own); `ritual`; `focus` (item categories that can be a focus).

### Subclasses

`class` (the class it belongs to), `levels` as for a class (counted in the class's levels), and optional `columns`.

### Backgrounds

`effects`, `startingEquipment`, and `characteristics`: lists of `traits`, `ideals` (`{ "text", "alignment" }`),
`bonds` and `flaws`, offered as suggestions on the Details step.

### Feats

| Field | Meaning |
|---|---|
| `requires` | Any of `abilities` (all needed: `[{ "ability": "str", "min": 13 }]`), `proficiency` (`{ "kind": "armor", "id": "medium" }`), `spellcasting: true`. |
| `repeatable` | `true` if it can be taken more than once. |
| `effects` | What it gives. Its ability increases stop at 20. |

### Items

`categories` (e.g. `["weapon", "martial-weapons"]`, used by starting equipment), `cost` (`{ "amount": 15, "unit": "gp" }`),
`weight` (pounds, for the whole bundle), `bundle` (sold 20 at a time), `attunement` (`true`, or who can attune:
`"by a cleric"`), `weapon` (`class`, `range`, `damage`, `versatile`, `properties`, `normal`/`long`), `armor` (`class`,
`base`, `dex`, `strength`, `stealthDisadvantage`), and `contents` for an equipment pack.

### Spells

`level` (0 for a cantrip), `school`, `classes` (the class ids whose lists have it), `castingTime`, `range`,
`components` (`verbal`, `somatic`, `material`), `duration`, `concentration`, `ritual`, `higherLevels`.

### Languages

`exotic` and `script`.

## Effects

An effect is a typed statement the rules module knows how to apply. Races, subraces, backgrounds, feats and class and
subclass levels all carry lists of them.

| Type | Fields | Example |
|---|---|---|
| `ability-bonus` | `ability`, `amount` | `{ "type": "ability-bonus", "ability": "dex", "amount": 2 }` |
| `speed` | any of `walk`, `fly`, `swim`, `climb`, `burrow` | `{ "type": "speed", "walk": 25 }` |
| `sense` | `sense` (darkvision, blindsight, tremorsense, truesight), `range` | `{ "type": "sense", "sense": "darkvision", "range": 60 }` |
| `proficiency` | `kind` (skill, saving-throw, weapon, armor, tool), `id` | `{ "type": "proficiency", "kind": "skill", "id": "perception" }` |
| `expertise` | `kind` (skill or tool), `id` | `{ "type": "expertise", "kind": "skill", "id": "stealth" }` |
| `language` | `id` | `{ "type": "language", "id": "srd-5.1:elvish" }` |
| `resistance` | `damage` | `{ "type": "resistance", "damage": "poison" }` |
| `grant` | `collection`, `id` | `{ "type": "grant", "collection": "feats", "id": "steady-hands" }` |
| `armor-class` | `base`, `abilities`, `shield` (false if a shield isn't allowed) | `{ "type": "armor-class", "base": 10, "abilities": ["dex", "con"] }` |
| `armor-class-bonus` | `amount`, `while` (armored or unarmored) | `{ "type": "armor-class-bonus", "amount": 1, "while": "armored" }` |
| `hit-points` | `perLevel` (a class's counts its own levels) | `{ "type": "hit-points", "perLevel": 1 }` |
| `resource` | `id`, `name`, `uses`, `recharge` (short, long, dawn) | `{ "type": "resource", "id": "rage", "uses": { "column": "rage-count" }, "recharge": "long" }` |
| `feature` | `name`, `summary`, `description`, `source` | `{ "type": "feature", "name": "Trance", "summary": "Four hours of meditation instead of sleep." }` |
| `spell` | `id`, `ability`, `always` (always prepared), `level` (the class level it comes at) | `{ "type": "spell", "id": "srd-5.1:thaumaturgy", "ability": "cha" }` |
| `expanded-spells` | `ids` (added to a class's list) | `{ "type": "expanded-spells", "ids": ["srd-5.1:burning-hands"] }` |
| `ability-score-improvement` | `id` | `{ "type": "ability-score-improvement", "id": "asi-4" }` |
| `choice` | see below | |

A resource's `uses` is a number, a class table column (`{ "column": "ki-points" }`), an ability modifier
(`{ "ability": "cha", "add": 1, "min": 1 }`), or so many per class level (`{ "perLevel": 5 }`).

## Choices

A `choice` effect opens a choice on the character's step. Its `id` names the stored answer (unique within the entry),
`label` is what the player reads, and `pick` is how many: a number, or a class table column
(`{ "column": "invocations-known" }`) so it grows with level. It picks from one of four places:

```json
{ "type": "choice", "id": "language", "label": "Choose one extra language", "pick": 1, "from": { "collection": "languages" } }
{ "type": "choice", "id": "abilities", "label": "Choose two abilities", "pick": 2, "from": { "list": "abilities" }, "each": { "type": "ability-bonus", "amount": 1 } }
{ "type": "choice", "id": "style", "label": "Fighting Style", "pick": 1, "from": { "options": [ { "id": "defense", "name": "Defense", "effects": [ { "type": "armor-class-bonus", "amount": 1, "while": "armored" } ] } ] } }
{ "type": "choice", "id": "expertise", "label": "Expertise", "pick": 2, "from": { "proficient": ["skill", "tool:thieves-tools"] }, "each": { "type": "expertise" } }
```

- **A collection:** each pick is granted. `where` narrows it (`{ "classes": "wizard", "level": [0, 1] }`: a list field
  matches if it contains the value, and a list of values matches any). For spells: `ability` casts them with that
  ability, `known` counts them among the class's spells known, `spellbook` marks spells already in the spellbook,
  `note` labels each pick and `always` makes them always prepared.
- **A fixed list** (`abilities`, `skills`, `damage-types`), with `only` or `except` to narrow it and `each` saying what
  every pick gives.
- **Written-in options**, each with its own effects. An option may have `requires`: a class `level`, an `option` picked
  in another of the class's choices (`{ "choice": "pact-boon", "id": "blade" }`), or a `spell` known.
- **Your proficiencies**, for expertise.

## Checking a pack

The app checks every pack before using it: the fields first, then that every reference points at something. Each
problem names the place and what's wrong:

```
collections.races[0].effects[2]: unknown effect type "darkvison" (known: ability-bonus, speed, sense, ...)
collections.feats[0].effects[1]: no skill "perseption".
collections.subraces[0].race: no races entry "elff" in the pack "srd-5.1".
```

To check one now, put `$schema` in it and open it in an editor that understands JSON Schema; references to other
packs are checked when the app loads it. To try one in the app during Milestone 1, add its path to `BUILT_IN_PACKS` in
`frontend/src/app/packs.ts` after the packs it requires, and put the file in `frontend/public/packs/`. From Milestone 2,
you'll upload packs to your account instead, after agreeing that you own the rights to what you upload.
