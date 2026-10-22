# Where the A5E monsters come from

| | |
|---|---|
| Content | Monstrous Menagerie creatures (Advanced 5th Edition), by EN Publishing |
| Served by | Open5e's public API, `https://api.open5e.com/v2/creatures/?document__key=a5e-mm` (586 creatures) |
| File | `open5e-a5e-mm.json`: the creatures as Open5e serves them, **slimmed** (see below) |
| Licence | Open5e labels the document **OGL 1.0a**. EN Publishing's A5E System Reference Document is offered under the ORC License, Creative Commons and the OGL. The text of the licences and the Section 15 notices are in `frontend/public/legal/`. |
| Credit | `A5E_ATTRIBUTION` in `cauldron/rules.py`, carried by every A5E monster |
| Downloaded | October 2026 |

## What is kept and what is not

Only game statistics and ability text are kept. `cauldron.seed.a5e.slim` removes, before the file is saved:

- art (`illustration`) and cross references,
- the `document` block,
- the long paragraphs Open5e files among the actions (lore and notes such as "An acolyte is a priest in training..."), which
  are descriptions, not abilities.

The importer then gives every monster an empty description. Nothing from the books' lore, art, logos or trade dress is in the library.

## Rebuilding

```
cd backend
.venv\Scripts\python -m cauldron.seed.a5e            # converts the saved file into frontend/public/data/a5e-monsters.json
.venv\Scripts\python -m cauldron.seed.a5e --fetch    # downloads from Open5e first (needs network access)
```

A creature whose name is already in the library is called "Name (A5E)". The conversion report is `backend/data/a5e-import-report.md`.

## Not the same rules as the SRD

A5E rebalances many creatures: its Aboleth is CR 11 with 171 hit points, where the SRD's is CR 10 with 135. The page labels these monsters, and
the challenge rating estimator is calibrated on the SRD only (adding these did not improve it; see `docs/A5E.md`).
