# Exports

Everything is built in the browser and saved with the browser's download. There is no server.

## What you can export

| Button | Where | File |
|---|---|---|
| Export JSON | stat block pop-out | `monster-<name>.json`: the monster exactly as stored, in a small wrapper |
| Export for Foundry (experimental) | stat block pop-out | `fvtt-Actor-<name>.json`: an NPC actor for Foundry VTT's D&D 5e system |
| Export JSON | encounter card | `encounter-<name>.json`: name, party, rows, the XP math and rating, and every monster's full stat block |

Our own JSON files carry `app`, `kind` and `format_version`, so a future import feature can check them before trusting a file. The encounter file's `summary` block is informational: an importer should recompute it.

## Foundry VTT

**Target:** the D&D 5e system, version **5.3.3** (it runs on Foundry V13 and V14). The version lives in one place, `FOUNDRY_TARGET` in `src/lib/foundryMaps.ts`. Everything is marked as the **2014 rules**.

**How to import**
1. In Foundry, create a blank NPC actor (Actors tab, Create Actor, type NPC).
2. Right-click it in the Actors tab, choose **Import Data**, and pick the downloaded file.
3. In the D&D 5e system settings, set **Rules Version** to Legacy (2014).

### How a monster maps

| Our monster | In Foundry | How faithful |
|---|---|---|
| Name, size, type, alignment, CR | Same fields on the actor and token | Exact |
| Ability scores, saving throws, skills | Scores, proficiency flags, and a flat bonus for anything unusual | Exact: the totals add up to the printed numbers (checked for every sample monster) |
| Hit points and hit dice, armor class, speeds, senses | Same fields | Exact. The armor note goes in the biography |
| Resistances, immunities, vulnerabilities, condition immunities, languages | Same fields. Text Foundry has no key for goes in a free-text field | Exact, or kept as text |
| Weapon attacks (melee and ranged) | A weapon with an attack that derives its to-hit from the ability, plus damage | Exact |
| Spell attacks (for example Mind Lash) | A feature with a flat to-hit attack | Numbers exact |
| Saving-throw abilities (breath weapons, auras) | A feature with a save: DC, damage on a failed save, half or none on a success, area, recharge | Exact |
| Traits, Multiattack, reactions, legendary options | Features, with the same wording as the stat block. Legendary options carry their cost | Text only (Multiattack is not linked to the attacks) |
| Spellcasting | A feature with the text, and the casting ability set | Text only: no spells or slots are created |
| Legendary actions | The sheet's legendary action pool, set from our count | Exact |
| Legendary Resistance | A feature with the text, and the sheet counter filled in | Text only: the counter is not linked to the feature |
| Passive Perception, XP, proficiency bonus, spell save DC | Calculated by Foundry | Not written. If our printed value differs from what Foundry will calculate, the export says so |
| Environments | A free-text habitat field | Text only |

When something cannot be converted, the app tells you after the download ("Notes: ...") instead of failing.

### What we do not know yet

- **A live import has not been tested.** Nobody who built this can run Foundry, so the file is checked against real files from the system instead: every field it writes must appear in one of six real SRD monsters, a dragon written in our format must reproduce the real dragon's values, and the arithmetic is checked for all 20 sample monsters. That makes surprises unlikely and failures easy to locate, but it does not prove the import works. Please test one (the checklist below) and report what you see.
- The real 5.3.3 files still store a few things in older shapes (senses, environment, legendary pool) that Foundry converts when it loads them. We write both the older and the newer form, holding the same numbers, so either way the value arrives. If one of those fields comes out empty, that is the place to look.
- Foundry 14.369 can run system 5.3.x or 6.0.x. If you run 6.0.x, two fields (armor class, flat movement) rely on that version converting the 5.3 form.

### Manual test checklist (about 20 minutes)

1. Check your system version: Foundry's setup screen, Game Systems list, or press F12 and run `game.system.version`.
2. Import **Cinderkite** (simple): the sheet should show AC 13, HP 7, fly 50 ft., a Talons attack, Keen Sight.
3. Import **Stormhide Drake**: Stormbreath with a recharge and a 30-foot line template, Bite and Claw attacks, Multiattack text.
4. Import **Voidbloom Seer**: legendary actions (3 per round), Mind Lash spell attack, Spellcasting text.
5. On each, roll one attack and one save from the sheet: check the to-hit and damage against the stat block.
6. Check Senses, Languages, Skills, and Saves on the sheet.
7. Write down what differed, with the system version, and tell me.

### Fixtures and licence

The test fixtures in `src/lib/fixtures/foundry-dnd5e-5.3.3/` are trimmed copies of six SRD monsters from the Foundry dnd5e system (tag `release-5.3.3`, CC-BY-4.0). Each file records its source URL, tag, and what was trimmed in a `_provenance` key. The generated files in `src/lib/goldens/` are our own exported actors for three monsters; a test rewrites them, so any change to the format shows up in review.

## Roll20

Not built yet. See the project notes for the options.
