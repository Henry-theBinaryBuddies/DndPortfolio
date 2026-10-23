# Licences

Creature Cauldron has two kinds of material, and they are licensed separately.

| What | Licence | Where |
|---|---|---|
| The code (`backend/src`, `frontend/src`, tests, scripts) | MIT | `LICENSE` |
| SRD 5.1 monsters (`frontend/public/data/srd-monsters.json`) | Creative Commons Attribution 4.0 (credited exactly, `SRD_ATTRIBUTION`), also available under the OGL v1.0a | `backend/data/srd-2014/SOURCE.md` |
| A5E Monstrous Menagerie monsters (`frontend/public/data/a5e-monsters.json`) | Open Game License v1.0a (EN Publishing also offers the A5ESRD under the ORC License) | `backend/data/a5e-mm/SOURCE.md` |
| Monsters Creature Cauldron generates, reskins and combines | Open Game License v1.0a | this file |

## What the Open Game License asks of us, and where it is done

- **A copy of the licence with the content.** `frontend/public/legal/OGL-1.0a.txt` and the Licences page (`frontend/public/legal/licences.html`),
  linked from the footer of every page.
- **Section 15, the copyright notices.** Listed at the end of the licence text on the Licences page: Wizards of the Coast's licence and SRD 5.1
  notices, EN Publishing's A5ESRD credit, and Creature Cauldron's own line. **Keep this list in step with every source added.**
- **Saying which parts are Open Game Content.** The "Open Game Content and Product Identity" section of the Licences page.
- **No Product Identity, no compatibility claims.** The importers keep statistics and ability text only (no art, lore, logos or descriptions),
  and nothing here says the site is compatible with any trademark.
- **The credit travels with each monster.** Every A5E monster carries `A5E_ATTRIBUTION` and every SRD monster `SRD_ATTRIBUTION`; both appear in
  the stat block and in the exports, and the validator rejects a monster with the wrong one.

The text of the Licences page is not legal advice and was assembled by the project's author. Before the site is made public, check each
source's own printed notices against the Section 15 list.
