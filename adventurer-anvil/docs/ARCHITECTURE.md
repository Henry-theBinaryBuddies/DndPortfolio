# Adventurer Anvil: architecture

Agreed 8 Nov 2026 (Milestone 1, step 1).

```
        App shell (React)        screens, storage, look
               │
              Core               knows no game rules
           ┌───┴────┐
   System module   Content packs
   dnd5e-2014:     SRD 5.1, your books:
   the rules       data only
```

## The four parts

1. **App shell** (`src/app/`): the step screens, the sheet, the look, saving to the browser. It never calculates anything: it asks the core what to show and hands it the user's choices.
2. **Core** (`src/core/`): knows no game. Its ideas are general: a *character* is a document of *choices*; a *step* is a screen of choices described by a system module; a *derived value* is anything calculated from choices; a *validation result* says whether a choice is legal and why; an *override* is a DM unlocking an illegal choice. It loads and checks content packs and asks the system module to do the rules work.
3. **System module** (`src/systems/<id>/`, first `dnd5e-2014`): all the rules of one game, and only there. It supplies the steps, the derived-value calculations, the legality checks, the sheet layout, the exporters, and the schema its content packs must follow.
4. **Content packs** (`public/packs/`, and later each account's private packs): data only, never logic. A pack says what a High Elf has; the module says how that is applied.

## The rule

Each layer depends only on the layer below it, and the core never mentions a specific game. No "Strength", "spell slot" or "d20" in the core or the app shell. `src/boundaries.test.ts` checks this on every test run.

Adding a system (D&D 2024, Pathfinder, Kids on Bikes, ...) means a new system module and its packs, with no change to the core or the shell.

## Example: choosing High Elf

1. The shell sends the choice `race = srd:high-elf`.
2. The core records it in the character document and asks the module to recompute.
3. The module reads High Elf from the SRD pack, applies +2 Dex and +1 Int, adds the traits, opens a new choice (one wizard cantrip), and re-checks earlier choices.
4. The core returns the derived values, open choices and warnings.
5. The shell redraws the summary, shows the cantrip picker, and flags any step the change made invalid.

## Decisions

- **A. Rules run in the browser, in TypeScript.** The Milestone 2 server stores characters but does not recompute them; it trusts the client's numbers, acceptable for a non-competitive tool. The rules are written once.
- **B. Choices are stored; derived values are not.** Rules fixes and pack updates reach old characters automatically.
- **C. Packs are referenced by id and version** (`srd-5.1@1.0`). A character that uses a pack not loaded on this device still opens, with the affected choices shown as missing content.
- **D. Saving goes through one interface.** The screens use only `CharacterStore` (`src/app/store.ts`): list, load, save, remove, and watch for changes made elsewhere. Milestone 1's `LocalStore` keeps each character in the browser's localStorage beside a small index of summaries; Milestone 2's account storage will be another `CharacterStore`. Every file, from storage or from the user's computer, is opened through the core's `readCharacter` (`src/core/open.ts`), which refuses what it can't read safely (not a character, a newer app or rules, another game, a damaged file), runs the system's `migrate` on older files, and notes missing or different packs. The system's `describe` gives the words and portrait a list shows.
- **E. The system lays out the sheet; the app draws it.** A system module's `sheet` is a list of pages, each a band across the top, columns side by side and full-width sections, made of a few generic kinds (identity, tiles, stats, checklist, rows, list, text, records; and, for a sheet filled in by hand, blanks, ticks, portrait and split), each naming derived values, lists or choices by key. The app draws them, adds DM rulings and the packs' credits, and prints them with its own styles, without knowing the game. The same goes for levelling up (`levelUp`, optional) and the choice kinds the shell can draw: anything a system needs that the shell can't draw is a new generic kind (records, steppers that start from a count), never a game-specific screen.
- **F. Exporters belong to the system; other programs' formats come from those programs.** A system module lists its `exporters`; each turns a character into a file (name, type, text, and warnings to show first), and the app gives each a button without knowing the format. The Tome & Tile export builds Tome & Tile's `Creature` message with Tome & Tile's own generated TypeScript types, copied unchanged into `systems/dnd5e-2014/export/tomeandtile/gen/` by `tools/sync-tomeandtile.ts` (which records the commit and each file's hash, checked by a test), and writes it with `@bufbuild/protobuf`, so the file always matches Tome & Tile's contract. Anvil's code is AGPL-3.0, like Tome & Tile's.
