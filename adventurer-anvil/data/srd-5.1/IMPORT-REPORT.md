# SRD 5.1 import report

Written by `tools/import-srd.ts` (`npm run import:srd`); do not edit by hand. Pack version 0.1.0.

Imported: **9 races** (Dwarf, Elf, Halfling, Human, Dragonborn, Gnome, Half-Elf, Half-Orc, Tiefling), **4 subraces**
(Hill Dwarf, High Elf, Lightfoot Halfling, Rock Gnome) and **16 languages**. The pack passes the app's own check (`readPack`).
Classes, backgrounds, feats, spells and items join as each gets its pack format.

## How the 38 racial traits were brought in

### Calculated (8)

| Trait | Note |
|---|---|
| Darkvision |  |
| Dwarven Combat Training |  |
| Keen Senses |  |
| Skill Versatility |  |
| Menacing |  |
| Hellish Resistance |  |
| Elf Weapon Training |  |
| Extra Language |  |

### Calculated, with the text kept (6)

| Trait | Note |
|---|---|
| Dwarven Resilience | Poison resistance is calculated; advantage on saves against poison is described. |
| Draconic Ancestry | A choice of damage type gives the resistance; the dragon's colour is not stored, only its damage type. |
| Breath Weapon | Tracked as 1 use per short rest; its damage and DC are described until the sheet calculates them. |
| Relentless Endurance | Tracked as 1 use per long rest. |
| High Elf Cantrip | The cantrip is a choice; its text says Intelligence is the spellcasting ability. |
| Tinker | The tool proficiency is calculated; building clockwork devices is described. |

### Kept as text for now (3)

| Trait | Becomes calculated when |
|---|---|
| Tool Proficiency | The choice of artisan's tools becomes a real choice once items exist. |
| Infernal Legacy | The spells it grants are added once spells exist. |
| Dwarven Toughness | +1 hit point per level is added once classes give hit points. |

### Described: nothing to calculate (10)

Stonecunning, Fey Ancestry, Trance, Brave, Halfling Nimbleness, Lucky, Gnome Cunning, Savage Attacks, Naturally Stealthy, Artificer's Lore.

### Folded into another trait (11)

| Trait | Note |
|---|---|
| Draconic Ancestry (Black) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Blue) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Brass) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Bronze) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Copper) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Gold) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Green) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Red) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (Silver) | Its row is in the Draconic Ancestry table in that trait's text. |
| Draconic Ancestry (White) | Its row is in the Draconic Ancestry table in that trait's text. |
| Damage Resistance | The resistance is given by the Draconic Ancestry choice. |

## Corrections (3)

Each is in `data/srd-5.1/corrections.ts`, with its reason.

- **high-elf-cantrip**: Typo in the community file ("form" for "from").
- **brave**: Typo in the community file ("saving throw" for "saving throws").
- **relentless-endurance**: A sentence starting in lower case in the community file.

## Not in SRD 5.1, so not shipped

Variant Human, and every subrace beyond the four above: these belong in private packs. The community files also carry no
name lists or random height and weight tables, so the Details step's suggestions for these races will come from private packs.
