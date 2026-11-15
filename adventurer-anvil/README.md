# Adventurer Anvil

A D&D character creator in the spirit of Roll20's Charactermancer: guided steps, legal choices, a finished sheet. The first rules system is 2014 5e with SRD 5.1 content; the core is built so other systems can be added as modules.

**Status (14 Nov 2026):** Milestone 1, step 7 of 9 (the builder's screens, one step at a time). Done: the
system-agnostic core (characters, choices, overrides, dice, content packs), the 2014 pack format with its JSON Schema,
the 2014 rules engine, SRD 5.1's races, subraces, classes, subclasses, the Acolyte background, languages, mundane items and spells as the built-in pack, and the first
screens: the Race step, the Abilities step (standard array, point buy, rolling with a roll log), the Class step (level 1:
the class, its skills and level-1 choices, the subclass where it comes at level 1, hit points, Armor Class and what the
class gives), the Background step (its skills and choices, a swap for any skill given twice, and personality
written freely with the background's tables as suggestions), the Equipment step (the class and background packages, or
starting gold and a shop; what you wear, with Armor Class, attacks, money and weight worked out), the Spells step (cantrips,
spells known or a wizard's spellbook, prepared spells, domain and racial spells, save DC, attack bonus and slots), a live
summary, Review and Licences. Nothing is saved yet (step 8). `npm run test:browser` runs the browser and accessibility tests. See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for
what it will do, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it is put together, and [`LICENSES.md`](LICENSES.md).

## Run it

```
cd frontend
npm install
npm run dev     # http://localhost:5205
npm test
npm run build   # static site in frontend/dist
npm run schema      # rewrite the published pack JSON Schema after a pack format change
npm run import:srd  # rebuild the SRD 5.1 pack from data/srd-5.1/raw (see its SOURCE.md)
```

Stack: TypeScript, React, Vite, Vitest (as Creature Cauldron's frontend). A Python backend joins in `backend/` at Milestone 2.

## Layout

- `frontend/src/app/`: the app shell (React screens). Calculates nothing.
- `frontend/src/core/`: system-agnostic core. No React, no game words.
- `frontend/src/systems/dnd5e-2014/`: the 2014 rules module.
- `frontend/public/packs/`: built-in content packs, loaded as data at run time.
- `frontend/src/boundaries.test.ts`: fails if the layering rule is broken.
- `frontend/public/schemas/`: the published JSON Schema for 2014 packs, for editors such as VS Code.
- `data/srd-5.1/`: the pinned SRD source files, corrections, the hand-made check table and the import report.
- `tools/`: the SRD importer (`npm run import:srd`).
