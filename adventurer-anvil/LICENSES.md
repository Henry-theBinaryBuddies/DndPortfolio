# Licences

| What | Licence | Details |
|---|---|---|
| Adventurer Anvil's code | GNU Affero General Public License v3.0 only (AGPL-3.0-only), chosen 24 Nov 2026 to match Tome & Tile, which Anvil may later fold into | [`LICENSE`](LICENSE) |
| The copied Tome & Tile contract types (`frontend/src/systems/dnd5e-2014/export/tomeandtile/gen/`) | AGPL-3.0-only, from Tome & Tile's `contracts/ts`; generated from its Protobuf contracts | the header of each file, and `SOURCE.md` beside them |
| SRD 5.1 content (`frontend/public/packs/srd-5.1.pack.json`) | Creative Commons Attribution 4.0 International, credited with the exact statement below | `data/srd-5.1/raw/SOURCE.md` |
| The 5e-bits community data files the SRD pack is imported from (`data/srd-5.1/raw/`) | MIT (the files' code licence; the content is the SRD above) | `data/srd-5.1/raw/LICENSE-5e-bits-MIT.md` |

## The SRD credit

This exact statement goes with the SRD content wherever it is shown or exported. It is the pack's `attribution` field;
the app shows it in the page footer (from the first screen, Milestone 1 step 7) and in every export that uses the pack.

> This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and
> available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative
> Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

## Private packs

Packs made from books you own are never shipped with the site and are not covered here: see `docs/REQUIREMENTS.md`,
"Own content packs". **Keep this file in step with every source added.**
