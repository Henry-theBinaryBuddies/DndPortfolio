# The A5E monsters, and why the estimator ignores them

## What was added

586 creatures from EN Publishing's Monstrous Menagerie (Advanced 5th Edition), shown in the library with the source "A5E". The library is now
20 samples + 333 SRD + 586 A5E = 939 monsters.

- **Where from.** Open5e's public API (`document__key=a5e-mm`). The saved, slimmed copy is `backend/data/a5e-mm/open5e-a5e-mm.json`, with provenance in
  `backend/data/a5e-mm/SOURCE.md`.
- **What is kept.** Statistics and ability text only. Art, cross references and the long lore paragraphs Open5e files among the actions are dropped
  (`seed/a5e.py: slim`), and every monster has an empty description.
- **How.** `python -m cauldron.seed.a5e` converts each Open5e record into the shape of the SRD data file (`convert`), then the SRD importer
  (`import_monster`, with the A5E source, credit and id prefix) does the parsing, so both libraries are read by the same code. The output is
  `frontend/public/data/a5e-monsters.json` (about 1.6 MB; the server loads the same file, so A5E monsters can be reskinned, polymorphed and used as donors).
  The report is `backend/data/a5e-import-report.md`: 586 imported, none skipped, none rejected.
- **Names.** 292 A5E creatures share a name with an SRD or sample monster (A5E rebuilt most SRD monsters), so they are called "Name (A5E)". Every name
  and id in the library is unique (tested).
- **Rules.** `Source.A5E`; the validator treats it like the SRD ("official numbers stay as printed", the exact credit is required: `A5E_ATTRIBUTION`).
  The ability score cap is now 40 (some published creatures pass 30; the A5E ones top out at 30).
- **On the page.** A Source filter (SRD 5.1, A5E, Curated samples, Generated, Reskin), an "A5E" tag in the results, a note in the stat block that its
  numbers follow A5E and not the 2014 rules, the credit in the footer, and a Licences page (`frontend/public/legal/`).

## Licences

See `LICENSES.md`. In short: the code is MIT; the monster data is credited under CC BY 4.0 (SRD) and used under the Open Game License v1.0a (A5E, and the
monsters Creature Cauldron makes). `test_legal.py` keeps the credits identical on both sides, the licence text whole, and Section 15 complete.
Open5e labels Monstrous Menagerie OGL 1.0a only; EN Publishing's own site says the A5ESRD is offered under CC, the OGL and the ORC License and does not say
whether the bestiary is in the A5ESRD. The printed Section 15 notice of the book itself (its copyright years) has not been checked: do that before
the site goes public.

## Why the challenge rating estimator stays SRD-only

Three experiments, each a leave-one-out test on the 333 SRD monsters (each monster estimated from curves built without it). Scripts were scratch files.

| Experiment | SRD mean error | Within 1 step | CR 11+ within 1 step |
|---|---|---|---|
| Today: isotonic curves, SRD only | 0.847 | 83.5% | 63% |
| Smooth log-polynomial fits (degree 1, 2, 3) | 1.60, 1.17, 0.87 | 56.5%, 80.5%, 84.1% | not better |
| Isotonic fit plus Gaussian smoothing (sigma 1) | 0.814 | 85.6% | gain within noise (95% interval -0.9% to +5.4%) |
| Adding all of Black Flag SRD (CC BY 4.0, 360 creatures) | 0.886 | 82.0% | 53% |
| Adding only Black Flag's ~40 new creatures | 0.856 | 83.5% | 61% |
| Adding A5E Monstrous Menagerie (561 converted at the time) | 0.850 | 84.4% | 67% |
| Adding only A5E creatures whose names are not in the SRD | 0.865 | 83.2% | 53% |

- **Smoothing** does not beat the isotonic fit by more than noise.
- **Black Flag** is mostly rebuilt SRD monsters under the same names (not independent data) and made things slightly worse; its dragons also have
  Constitution scores of 32 to 38. It was not imported.
- **A5E** is independent data but uses its own challenge rating scale: the SRD-calibrated estimator agrees with A5E's CRs within one step only 70% of the
  time (CR 5 to 10: 38%). Adding it to the calibration is neutral on the SRD, so it was not worth mixing two scales. The estimator therefore stays
  calibrated on the SRD, and A5E monsters are labelled as following A5E's numbers.

## Import details worth knowing

- **Multiattack.** Typed (with the counts of each attack) only when its first sentence is a plain form such as "attacks once with its bite and twice with its claws" or
  "makes two greatsword attacks"; 174 of 275 are. A sentence that offers a choice or replaces an attack stays prose (101), because a wrong count would price the creature wrongly.
- **Legendary actions.** The intro paragraph gives the number a round (1, 2 or 3) and is not an option; "(1/Day)" and recharge limits stay on the option.
- **Credits.** An A5E monster carries `A5E_ATTRIBUTION`. A reskin of one carries the same; an SRD monster polymorphed with an A5E donor carries both credits (`combined_credit`).
- **Text.** Open5e's A5E text is lightly marked up and lost its commas (as double spaces) and most apostrophes. Lists become one sentence, markup goes, commas are restored; only the
  stock "The aboleth's spellcasting ability" apostrophe is restored. The record's own hit dice are used, and physical resistances name only the types the line names.
- The second review's findings, and what was done about each, are in `CODE_REVIEW_2.md`.