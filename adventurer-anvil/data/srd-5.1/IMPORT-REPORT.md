# SRD 5.1 import report

Written by `tools/import-srd.ts` (`npm run import:srd`); do not edit by hand. Pack version 0.6.0.

Imported: **9 races** (Dwarf, Elf, Halfling, Human, Dragonborn, Gnome, Half-Elf, Half-Orc, Tiefling), **4 subraces**
(Hill Dwarf, High Elf, Lightfoot Halfling, Rock Gnome), **12 classes** (Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard),
**12 subclasses** (Berserker, Lore, Life, Land, Champion, Open Hand, Devotion, Hunter, Thief, Draconic, Fiend, Evocation), **1 background**
(Acolyte: its skills, languages, feature, characteristics and equipment),
**237 items** (every mundane item: weapons, armour, gear, tools, mounts and vehicles; magic items come later),
**319 spells** (with their full text) and **16 languages**. Every caster has its spellcasting:
the ability, the kind (known, prepared, spellbook or pact), and its table's cantrips, spells known and slots for levels 1 to 20.
Subclass spells are in: always prepared for the Life Domain and the Oath of Devotion, added to the list for the Fiend; the
Circle of the Land's wait for levelling up, as they depend on the terrain chosen at level 3. Every class and background has its starting equipment.
The pack passes the app's own check (`readPack`). Feats join when they get their pack format.

SRD 5.1 has no starting-wealth table (the rules text, checked at the same commit, starts its Equipment section with
coins), so no class carries `startingWealth`: with starting gold, the player enters the gold their DM gives them. A
private pack can add the dice.

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

### Calculated, with the text kept (9)

| Trait | Note |
|---|---|
| Dwarven Resilience | Poison resistance is calculated; advantage on saves against poison is described. |
| Tool Proficiency | A choice of one of the three artisan's tools. |
| Draconic Ancestry | A choice of damage type gives the resistance; the dragon's colour is not stored, only its damage type. |
| Breath Weapon | Tracked as 1 use per short rest; its damage and DC are described until the sheet calculates them. |
| Relentless Endurance | Tracked as 1 use per long rest. |
| Infernal Legacy | Thaumaturgy, cast with Charisma; Hellish Rebuke (level 3) and Darkness (level 5) wait for levelling up. |
| Dwarven Toughness | +1 hit point per level. |
| High Elf Cantrip | The cantrip is a choice (on the Spells step), cast with Intelligence. |
| Tinker | The tool proficiency is calculated; building clockwork devices is described. |

### Kept as text for now (0)

| Trait | Becomes calculated when |
|---|---|


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

Every feature from level 1 to 20 is in the pack. Those that need calculating or choosing are typed; the rest are kept
as their SRD text, shown in "What you get" at their level.

### Calculated (23)

| Class | Level | Feature | Note |
|---|---|---|---|
| Life (Cleric) | 1 | Bonus Proficiency | Heavy armour. |
| Barbarian | 1 | Rage | Uses per long rest from the Rages column; its damage bonus is in the class table. |
| Barbarian | 1 | Unarmored Defense | AC 10 + Dex + Con without armour; a shield is allowed. |
| Bard | 1 | Spellcasting: Bard | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Bard | 1 | Bardic Inspiration (d6) | Uses equal your Charisma modifier (at least one) per long rest. |
| Cleric | 1 | Spellcasting: Cleric | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Cleric | 1 | Domain Spells | The subclass gives the spells, always prepared, at the levels its table says. |
| Cleric | 3 | Domain Spells | The subclass gives the spells, always prepared, at the levels its table says. |
| Cleric | 5 | Domain Spells | The subclass gives the spells, always prepared, at the levels its table says. |
| Cleric | 7 | Domain Spells | The subclass gives the spells, always prepared, at the levels its table says. |
| Cleric | 9 | Domain Spells | The subclass gives the spells, always prepared, at the levels its table says. |
| Druid | 1 | Spellcasting: Druid | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Fighter | 1 | Second Wind | 1 use per short rest. |
| Monk | 1 | Unarmored Defense | AC 10 + Dex + Wis without armour or a shield. |
| Paladin | 1 | Divine Sense | Uses equal 1 + your Charisma modifier per long rest. |
| Paladin | 1 | Lay on Hands | The pool is tracked as hit points: 5 per paladin level, per long rest. |
| Paladin | 2 | Spellcasting: Paladin | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Paladin | 3 | Oath Spells | The subclass gives the spells, always prepared, at the levels its table says. |
| Ranger | 2 | Spellcasting: Ranger | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Sorcerer | 1 | Spellcasting: Sorcerer | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Warlock | 1 | Pact Magic | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Wizard | 1 | Spellcasting: Wizard | Cantrips, spells known or prepared, and slots come from the class's spellcasting and table. |
| Draconic (Sorcerer) | 1 | Draconic Resilience | +1 hit point per level, and AC 13 + Dex without armour. |

### Choices (95; 5 at level 1)

| Class | Level | Feature | Note |
|---|---|---|---|
| Barbarian | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Barbarian | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Barbarian | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Barbarian | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Barbarian | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Bard | 3 | Expertise |  |
| Bard | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Bard | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Bard | 10 | Expertise |  |
| Bard | 10 | Magical Secrets |  |
| Bard | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Bard | 14 | Magical Secrets |  |
| Bard | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Bard | 18 | Magical Secrets |  |
| Bard | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Cleric | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Cleric | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Cleric | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Cleric | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Cleric | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Druid | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Druid | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Druid | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Druid | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Druid | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 1 | Fighting Style |  |
| Fighter | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 6 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 14 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Fighter | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Monk | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Monk | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Monk | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Monk | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Monk | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Paladin | 2 | Fighting Style |  |
| Paladin | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Paladin | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Paladin | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Paladin | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Paladin | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Ranger | 1 | Favored Enemy (1 type) |  |
| Ranger | 1 | Natural Explorer (1 terrain type) |  |
| Ranger | 2 | Fighting Style |  |
| Ranger | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Ranger | 6 | Favored Enemy (2 types) |  |
| Ranger | 6 | Natural Explorer (2 terrain types) |  |
| Ranger | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Ranger | 10 | Natural Explorer (3 terrain types) |  |
| Ranger | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Ranger | 14 | Favored Enemy (3 enemies) |  |
| Ranger | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Ranger | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Rogue | 1 | Expertise |  |
| Rogue | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Rogue | 6 | Expertise |  |
| Rogue | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Rogue | 10 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Rogue | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Rogue | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Rogue | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Sorcerer | 3 | Metamagic |  |
| Sorcerer | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Sorcerer | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Sorcerer | 10 | Metamagic |  |
| Sorcerer | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Sorcerer | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Sorcerer | 17 | Metamagic |  |
| Sorcerer | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Warlock | 2 | Eldritch Invocations | As many as the Invocations Known column says. Prerequisites are checked; skills and spells are given. |
| Warlock | 3 | Pact Boon |  |
| Warlock | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Warlock | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Warlock | 11 | Mystic Arcanum (6th level) |  |
| Warlock | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Warlock | 13 | Mystic Arcanum (7th level) |  |
| Warlock | 15 | Mystic Arcanum (8th level) |  |
| Warlock | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Warlock | 17 | Mystic Arcanum (9th level) |  |
| Warlock | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Wizard | 4 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Wizard | 8 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Wizard | 12 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Wizard | 16 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Wizard | 19 | Ability Score Improvement | +2 to one score or +1 to two, none above 20. |
| Lore (Bard) | 6 | Additional Magical Secrets |  |
| Champion (Fighter) | 10 | Additional Fighting Style |  |
| Hunter (Ranger) | 3 | Hunter's Prey |  |
| Hunter (Ranger) | 7 | Defensive Tactics |  |
| Hunter (Ranger) | 11 | Multiattack |  |
| Hunter (Ranger) | 15 | Superior Hunter's Defense |  |
| Draconic (Sorcerer) | 1 | Dragon Ancestor | A choice of dragon; also gives Draconic. The damage type is used by later features. |

### Described: nothing to calculate (199)

Reckless Attack (Barbarian 2), Danger Sense (Barbarian 2), Primal Path (Barbarian 3), Extra Attack (Barbarian 5), Fast Movement (Barbarian 5), Path feature (Barbarian 6), Feral Instinct (Barbarian 7), Brutal Critical (1 die) (Barbarian 9), Path feature (Barbarian 10), Relentless Rage (Barbarian 11), Brutal Critical (2 dice) (Barbarian 13), Path feature (Barbarian 14), Persistent Rage (Barbarian 15), Brutal Critical (3 dice) (Barbarian 17), Indomitable Might (Barbarian 18), Primal Champion (Barbarian 20), Jack of All Trades (Bard 2), Song of Rest (d6) (Bard 2), Bard College (Bard 3), Bardic Inspiration (d8) (Bard 5), Font of Inspiration (Bard 5), Countercharm (Bard 6), Bard College feature (Bard 6), Song of Rest (d8) (Bard 9), Bardic Inspiration (d10) (Bard 10), Song of Rest (d10) (Bard 13), Bard College feature (Bard 14), Bardic Inspiration (d12) (Bard 15), Song of Rest (d12) (Bard 17), Superior Inspiration (Bard 20), Divine Domain (Cleric 1), Channel Divinity (1/rest) (Cleric 2), Channel Divinity: Turn Undead (Cleric 2), Divine Domain feature (Cleric 2), Destroy Undead (CR 1/2 or below) (Cleric 5), Channel Divinity (2/rest) (Cleric 6), Divine Domain feature (Cleric 6), Destroy Undead (CR 1 or below) (Cleric 8), Divine Domain feature (Cleric 8), Divine Intervention (Cleric 10), Destroy Undead (CR 2 or below) (Cleric 11), Destroy Undead (CR 3 or below) (Cleric 14), Destroy Undead (CR 4 or below) (Cleric 17), Divine Domain feature (Cleric 17), Channel Divinity (3/rest) (Cleric 18), Divine Intervention Improvement (Cleric 20), Druidic (Druid 1), Wild Shape (CR 1/4 or below, no flying or swim speed) (Druid 2), Druid Circle (Druid 2), Wild Shape (CR 1/2 or below, no flying speed) (Druid 4), Druid Circle feature (Druid 6), Wild Shape (CR 1 or below) (Druid 8), Druid Circle feature (Druid 10), Druid Circle feature (Druid 14), Timeless Body (Druid 18), Beast Spells (Druid 18), Archdruid (Druid 20), Action Surge (1 use) (Fighter 2), Martial Archetype (Fighter 3), Extra Attack (Fighter 5), Martial Archetype feature (Fighter 7), Indomitable (1 use) (Fighter 9), Martial Archetype feature (Fighter 10), Extra Attack (2) (Fighter 11), Indomitable (2 uses) (Fighter 13), Martial Archetype feature (Fighter 15), Action Surge (2 uses) (Fighter 17), Indomitable (3 uses) (Fighter 17), Martial Archetype feature (Fighter 18), Extra Attack (3) (Fighter 20), Martial Arts (Monk 1), Ki (Monk 2), Flurry of Blows (Monk 2), Patient Defense (Monk 2), Step of the Wind (Monk 2), Unarmored Movement (Monk 2), Monastic Tradition (Monk 3), Deflect Missiles (Monk 3), Slow Fall (Monk 4), Extra Attack (Monk 5), Stunning Strike (Monk 5), Ki Empowered Strikes (Monk 6), Monastic Tradition feature (Monk 6), Evasion (Monk 7), Stillness of Mind (Monk 7), Unarmored Movement (Monk 9), Purity of Body (Monk 10), Monastic Tradition feature (Monk 11), Tongue of the Sun and Moon (Monk 13), Diamond Soul (Monk 14), Timeless Body (Monk 15), Monastic Tradition feature (Monk 17), Empty Body (Monk 18), Perfect Self (Monk 20), Divine Smite (Paladin 2), Divine Health (Paladin 3), Sacred Oath (Paladin 3), Channel Divinity (Paladin 3), Extra Attack (Paladin 5), Aura of Protection (Paladin 6), Sacred Oath feature (Paladin 7), Aura of Courage (Paladin 10), Improved Divine Smite (Paladin 11), Cleansing Touch (Paladin 14), Sacred Oath feature (Paladin 15), Aura improvements (Paladin 18), Sacred Oath feature (Paladin 20), Ranger Archetype (Ranger 3), Primeval Awareness (Ranger 3), Extra Attack (Ranger 5), Ranger Archetype feature (Ranger 7), Land's Stride (Ranger 8), Hide in Plain Sight (Ranger 10), Ranger Archetype feature (Ranger 11), Vanish (Ranger 14), Ranger Archetype feature (Ranger 15), Feral Senses (Ranger 18), Foe Slayer (Ranger 20), Sneak Attack (Rogue 1), Thieves' Cant (Rogue 1), Cunning Action (Rogue 2), Roguish Archetype (Rogue 3), Uncanny Dodge (Rogue 5), Evasion (Rogue 7), Roguish Archetype feature (Rogue 9), Reliable Talent (Rogue 11), Roguish Archetype feature (Rogue 13), Blindsense (Rogue 14), Slippery Mind (Rogue 15), Roguish Archetype feature (Rogue 17), Elusive (Rogue 18), Stroke of Luck (Rogue 20), Sorcerous Origin (Sorcerer 1), Font of Magic (Sorcerer 2), Flexible Casting: Creating Spell Slots (Sorcerer 2), Flexible Casting: Converting Spell Slot (Sorcerer 2), Sorcerous Origin feature (Sorcerer 6), Sorcerous Origin feature (Sorcerer 14), Sorcerous Origin feature (Sorcerer 18), Sorcerous Restoration (Sorcerer 20), Otherworldly Patron (Warlock 1), Otherworldly Patron feature (Warlock 6), Otherworldly Patron feature (Warlock 10), Otherworldly Patron feature (Warlock 14), Eldritch Master (Warlock 20), Arcane Recovery (Wizard 1), Arcane Tradition (Wizard 2), Arcane Tradition feature (Wizard 6), Arcane Tradition feature (Wizard 10), Arcane Tradition feature (Wizard 14), Spell Mastery (Wizard 18), Signature Spell (Wizard 20), Frenzy (Berserker (Barbarian) 3), Mindless Rage (Berserker (Barbarian) 6), Intimidating Presence (Berserker (Barbarian) 10), Retaliation (Berserker (Barbarian) 14), Bonus Proficiencies (Lore (Bard) 3), Cutting Words (Lore (Bard) 3), Peerless Skill (Lore (Bard) 14), Disciple of Life (Life (Cleric) 1), Channel Divinity: Preserve Life (Life (Cleric) 2), Blessed Healer (Life (Cleric) 6), Divine Strike (Life (Cleric) 8), Supreme Healing (Life (Cleric) 17), Bonus Cantrip (Land (Druid) 2), Natural Recovery (Land (Druid) 2), Land's Stride (Land (Druid) 6), Nature's Ward (Land (Druid) 10), Nature's Sanctuary (Land (Druid) 14), Improved Critical (Champion (Fighter) 3), Remarkable Athlete (Champion (Fighter) 7), Superior Critical (Champion (Fighter) 15), Survivor (Champion (Fighter) 18), Open Hand Technique (Open Hand (Monk) 3), Wholeness of Body (Open Hand (Monk) 6), Tranquility (Open Hand (Monk) 11), Quivering Palm (Open Hand (Monk) 17), Channel Divinity: Sacred Weapon (Devotion (Paladin) 3), Channel Divinity: Turn the Unholy (Devotion (Paladin) 3), Aura of Devotion (Devotion (Paladin) 7), Purity of Spirit (Devotion (Paladin) 15), Holy Nimbus (Devotion (Paladin) 20), Fast Hands (Thief (Rogue) 3), Second-Story Work (Thief (Rogue) 3), Supreme Sneak (Thief (Rogue) 9), Use Magic Device (Thief (Rogue) 13), Thief's Reflexes (Thief (Rogue) 17), Elemental Affinity (Draconic (Sorcerer) 6), Dragon Wings (Draconic (Sorcerer) 14), Draconic Presence (Draconic (Sorcerer) 18), Dark One's Blessing (Fiend (Warlock) 1), Dark One's Own Luck (Fiend (Warlock) 6), Fiendish Resilience (Fiend (Warlock) 10), Hurl Through Hell (Fiend (Warlock) 14), Evocation Savant (Evocation (Wizard) 2), Sculpt Spells (Evocation (Wizard) 2), Potent Cantrip (Evocation (Wizard) 6), Empowered Evocation (Evocation (Wizard) 10), Overchannel (Evocation (Wizard) 14).

## Corrections (6)

Each is in `data/srd-5.1/corrections.ts`, with its reason.

- **high-elf-cantrip**: Typo in the community file ("form" for "from").
- **brave**: Typo in the community file ("saving throw" for "saving throws").
- **relentless-endurance**: A sentence starting in lower case in the community file.
- **rogue (equipment)**: The Rogue's "(a) a shortbow and quiver of 20 arrows" has no quiver in the community file; it is added.
- **ranger (equipment)**: The Ranger's "a longbow and a quiver of 20 arrows" has no quiver in the community file; it is added.
- **acolyte (equipment)**: The Acolyte's equipment in the community file has only the holy symbol, common clothes, the pouch and 15 gp. The SRD also gives a prayer book or prayer wheel, 5 sticks of incense and vestments. Vestments are an SRD item; the others are not, so they are added by name, without weights.

## Details suggestions

SRD 5.1 describes each race's age and size in words, so `tools/srd/details.ts` turns them into numbers by hand, with
the words beside each. Weights are suggested only where the SRD gives an average (as that average plus or minus 15%).
SRD 5.1 has no name lists; the name syllables in the same file are Adventurer Anvil's own, under its code licence.

## Not in SRD 5.1, so not shipped

Variant Human, every subrace beyond the four above, and every feat but Grappler: these belong in private packs.
Grappler is entered by hand from the SRD's text (`tools/srd/feats.ts`), as the pinned files have no feats. Random height and weight tables
and example names are not in SRD 5.1.
