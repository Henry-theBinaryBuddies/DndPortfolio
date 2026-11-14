# SRD 5.1 source files: provenance

The twelve JSON files here are a community copy of parts of the **System Reference Document 5.1**. They are the raw input of
the importer (`tools/import-srd.ts`) and are kept unchanged, so the import can be repeated exactly. Fixes are applied by
`../corrections.ts`, never by editing these files. (Creature Cauldron imports its SRD monsters from the same repository:
see `creature-cauldron/backend/data/srd-2014/SOURCE.md`.)

| | |
|---|---|
| Source repository | https://github.com/5e-bits/5e-srd-api |
| Path | `packages/5e-database/src/2014/en/` |
| Files | `5e-SRD-Races.json` (9 races, 26,193 bytes), `5e-SRD-Subraces.json` (4, 3,635 bytes), `5e-SRD-Traits.json` (38, 55,551 bytes), `5e-SRD-Languages.json` (16, 4,030 bytes); added 2026-11-13 for the Class step: `5e-SRD-Classes.json` (12, 150,567 bytes), `5e-SRD-Subclasses.json` (12, 54,190 bytes), `5e-SRD-Features.json` (407, 355,557 bytes), `5e-SRD-Levels.json` (290, 225,478 bytes), `5e-SRD-Proficiencies.json` (117, 46,680 bytes); added 2026-11-13 for the Background step: `5e-SRD-Backgrounds.json` (1, 11,831 bytes); added 2026-11-14 for the Equipment step: `5e-SRD-Equipment.json` (237, 269,665 bytes), `5e-SRD-Equipment-Categories.json` (39, 138,102 bytes; kept for reference, as each item lists its own categories) |
| Downloaded at commit | `1a6f8bfed1935ac76dd71a7590236825f324aa32` (tip of `main`, 2026-11-12); the class, background and equipment files were downloaded at the same commit |
| Last commit touching these files | `c441042ff955e1b5d690389fd34f056d4533c49d` (2026-09-23, when the database was merged into this repository), for the first four; not checked for the class and background files |
| Downloaded | 2026-11-12 (races, subraces, traits, languages); 2026-11-13 (classes, subclasses, features, levels, proficiencies, backgrounds); 2026-11-14 (equipment, equipment categories) |
| Code license | MIT (`LICENSE-5e-bits-MIT.md`, copied here as the MIT license requires) |
| Content license | The SRD 5.1 is published by Wizards of the Coast under CC-BY-4.0, and Adventurer Anvil credits it under CC-BY-4.0 with the exact statement in `tools/srd/build.ts` (`SRD_ATTRIBUTION`), carried in the pack's `attribution`. |

Also checked, not kept: `5e-SRD-Rules.json` (246,638 bytes, the SRD rules text, same commit, 2026-11-14), to see whether
SRD 5.1 has a starting-wealth table. It does not: its Equipment section starts with coins. So the SRD pack gives no
class starting-wealth dice.

To update: download the same files at a newer commit, update this table, run `npm run import:srd` in `frontend/`, and
read the test results and `../IMPORT-REPORT.md` for anything that changed.
