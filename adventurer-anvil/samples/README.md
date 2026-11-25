# Sample characters

Seven complete characters built from SRD 5.1 content (2014 rules), each in two forms:

- `characters/*.anvil.json`: Adventurer Anvil character files. Open one in Anvil with **Open a file…**.
- `tomeandtile/*.creature.json`: the same characters exported for Tome & Tile, as its `Creature` contract in Protobuf
  JSON. These are for Tome & Tile's Anvil importer and its tests.

| Character | Build | Shows in Tome & Tile |
|---|---|---|
| Aldric Thorne | Human Fighter 3 (Champion) | Weapon attacks, a versatile weapon's two-handed grip, Second Wind |
| Seraphine Vael | High Elf Wizard 3 (Evocation) | An attack cantrip (Fire Bolt), a save spell (Burning Hands), automatic damage (Magic Missile), three attacks (Scorching Ray), a reaction (Shield), 2nd-level slots |
| Bronna Ironhearth | Hill Dwarf Cleric 3 (Life Domain) | Healing with the modifier filled in (Cure Wounds), a save cantrip (Sacred Flame), always-prepared domain spells |
| Pip Underbough | Lightfoot Halfling Rogue 3 (Thief) | Finesse and ranged weapons, skills with expertise |
| Kael Wren | Half-Elf Ranger 3 (Hunter) | Spells known, a ranged weapon with long range |
| Mordecai Ash | Tiefling Warlock 3 (the Fiend) | Pact Magic slots, Eldritch Blast, a spell cast at will from an invocation (Mage Armor), a racial spell |
| Borin Stonehelm | Hill Dwarf Fighter 4 / Wizard 1 | A multiclass character: two hit dice sizes, a Wizard's slots beside a Fighter's attacks |

## Making them

They're made by `tools/samples.ts` with the real exporter, from the choices written in that file:

```
cd frontend
npm run samples            # writes the files
npm run samples -- --todo  # lists anything a character still needs
```

The script refuses to write a character with a step left to do or a rule problem, so every file here is complete. A
unit test (`src/systems/dnd5e-2014/export/samples.test.ts`) fails if the files no longer match what the exporter makes;
run the script again after a change to the rules, the SRD pack or the exporter.

## Known limits

- **Eldritch Blast** doesn't add Agonizing Blast's Charisma to its damage: invocation effects on other spells aren't
  modelled yet.
- **Features** (Sneak Attack, Second Wind…) are passive cards with their text; their uses are tracked as resources.
- **No portraits**: Tome & Tile needs an uploaded picture.
