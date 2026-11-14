# SRD 5.1 import report

Written by `tools/import-srd.ts` (`npm run import:srd`); do not edit by hand. Pack version 0.3.0.

Imported: **9 races** (Dwarf, Elf, Halfling, Human, Dragonborn, Gnome, Half-Elf, Half-Orc, Tiefling), **4 subraces**
(Hill Dwarf, High Elf, Lightfoot Halfling, Rock Gnome), **12 classes** (Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard),
**12 subclasses** (Berserker, Lore, Life, Land, Champion, Open Hand, Devotion, Hunter, Thief, Draconic, Fiend, Evocation), **1 background**
(Acolyte: its skills, languages, feature and characteristics; equipment arrives with the
Equipment step) and **16 languages**.
The pack passes the app's own check (`readPack`). Feats, spells and items join as each gets its pack format.

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

### Calculated, with the text kept (7)

| Trait | Note |
|---|---|
| Dwarven Resilience | Poison resistance is calculated; advantage on saves against poison is described. |
| Draconic Ancestry | A choice of damage type gives the resistance; the dragon's colour is not stored, only its damage type. |
| Breath Weapon | Tracked as 1 use per short rest; its damage and DC are described until the sheet calculates them. |
| Relentless Endurance | Tracked as 1 use per long rest. |
| Dwarven Toughness | +1 hit point per level. |
| High Elf Cantrip | The cantrip is a choice; its text says Intelligence is the spellcasting ability. |
| Tinker | The tool proficiency is calculated; building clockwork devices is described. |

### Kept as text for now (2)

| Trait | Becomes calculated when |
|---|---|
| Tool Proficiency | The choice of artisan's tools becomes a real choice once items exist. |
| Infernal Legacy | The spells it grants are added once spells exist. |

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

## How the 317 class and subclass features were brought in

Every feature from level 1 to 20 is in the pack. The level-1 ones that need calculating are typed; the rest are kept
as their SRD text until the step that uses them (levelling up, spells).

### Calculated (9)

| Class | Level | Feature | Note |
|---|---|---|---|
| Life (Cleric) | 1 | Bonus Proficiency | Heavy armour. |
| Barbarian | 1 | Rage | Uses per long rest from the Rages column; its damage bonus is in the class table. |
| Barbarian | 1 | Unarmored Defense | AC 10 + Dex + Con without armour; a shield is allowed. |
| Bard | 1 | Bardic Inspiration (d6) | Uses equal your Charisma modifier (at least one) per long rest. |
| Fighter | 1 | Second Wind | 1 use per short rest. |
| Monk | 1 | Unarmored Defense | AC 10 + Dex + Wis without armour or a shield. |
| Paladin | 1 | Divine Sense | Uses equal 1 + your Charisma modifier per long rest. |
| Paladin | 1 | Lay on Hands | The pool is tracked as hit points: 5 per paladin level, per long rest. |
| Draconic (Sorcerer) | 1 | Draconic Resilience | +1 hit point per level, and AC 13 + Dex without armour. |

### Choices (23; 5 at level 1)

| Class | Level | Feature | Note |
|---|---|---|---|
| Bard | 3 | Expertise | Opens when levelling up arrives. |
| Bard | 10 | Expertise | Opens when levelling up arrives. |
| Fighter | 1 | Fighting Style |  |
| Paladin | 2 | Fighting Style | Opens when levelling up arrives. |
| Ranger | 1 | Favored Enemy (1 type) |  |
| Ranger | 1 | Natural Explorer (1 terrain type) |  |
| Ranger | 2 | Fighting Style | Opens when levelling up arrives. |
| Ranger | 6 | Favored Enemy (2 types) | Opens when levelling up arrives. |
| Ranger | 6 | Natural Explorer (2 terrain types) | Opens when levelling up arrives. |
| Ranger | 10 | Natural Explorer (3 terrain types) | Opens when levelling up arrives. |
| Ranger | 14 | Favored Enemy (3 enemies) | Opens when levelling up arrives. |
| Rogue | 1 | Expertise |  |
| Rogue | 6 | Expertise | Opens when levelling up arrives. |
| Sorcerer | 3 | Metamagic | Opens when levelling up arrives. |
| Sorcerer | 10 | Metamagic | Opens when levelling up arrives. |
| Sorcerer | 17 | Metamagic | Opens when levelling up arrives. |
| Warlock | 3 | Pact Boon | Opens when levelling up arrives. |
| Champion (Fighter) | 10 | Additional Fighting Style | Opens when levelling up arrives. |
| Hunter (Ranger) | 3 | Hunter's Prey | Opens when levelling up arrives. |
| Hunter (Ranger) | 7 | Defensive Tactics | Opens when levelling up arrives. |
| Hunter (Ranger) | 11 | Multiattack | Opens when levelling up arrives. |
| Hunter (Ranger) | 15 | Superior Hunter's Defense | Opens when levelling up arrives. |
| Draconic (Sorcerer) | 1 | Dragon Ancestor | A choice of dragon; also gives Draconic. The damage type is used by later features. |

### Level 1, described: nothing to calculate (10)

Divine Domain (Cleric), Druidic (Druid), Martial Arts (Monk), Sneak Attack (Rogue), Thieves' Cant (Rogue), Sorcerous Origin (Sorcerer), Otherworldly Patron (Warlock), Arcane Recovery (Wizard), Disciple of Life (Life (Cleric)), Dark One's Blessing (Fiend (Warlock)).

### Kept as text for now (275)

275 features, of which 7 at level 1 (Spellcasting: Bard, Spellcasting: Cleric, Domain Spells, Spellcasting: Druid, Spellcasting: Sorcerer, Pact Magic, Spellcasting: Wizard): spellcasting
arrives with the Spells step, and features above level 1 are typed when levelling up arrives.

## Corrections (3)

Each is in `data/srd-5.1/corrections.ts`, with its reason.

- **high-elf-cantrip**: Typo in the community file ("form" for "from").
- **brave**: Typo in the community file ("saving throw" for "saving throws").
- **relentless-endurance**: A sentence starting in lower case in the community file.

## Not in SRD 5.1, so not shipped

Variant Human, and every subrace beyond the four above: these belong in private packs. The community files also carry no
name lists or random height and weight tables, so the Details step's suggestions for these races will come from private packs.
