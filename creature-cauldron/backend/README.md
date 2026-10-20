# Creature Cauldron back end

Python models, rules engine, validator and (later) the generator API. Built test-first; the front end in
`../frontend` keeps working without it.

## Status

Parts 1 to 3 of phase 2 are done (the domain models, the rules tables, the validator, the reskin templates and the SRD seed pipeline), and part 4 is built except for the real AI: the web service works end to end with a scripted stand-in for Haiku.

| Module | What it holds |
|---|---|
| `cauldron/options.py` | The fixed option lists (sizes, types, damage types, …) as enums, matching `frontend/src/lib/options.ts` |
| `cauldron/dice.py` | Dice parsing, averages and ability modifiers |
| `cauldron/actions.py` | The action class hierarchy: abstract `Action`, then `AttackAction`, `SaveAction`, `MultiattackAction`, `TextAction`, each writing its own stat block prose |
| `cauldron/monster.py` | `Monster` and its parts, including structured `Spellcasting` and `LegendaryActions` |
| `cauldron/rules.py` | SRD 5.1 tables only: XP and proficiency bonus by CR, hit die by size, and the exact SRD attribution text |
| `cauldron/validator.py` | Abstract `Check` with nine rule subclasses (name, derived fields, hit points, attack bonus, save DC, spellcasting, legendary actions, features, attribution) and the `Validator` that runs them over a copy |
| `cauldron/blocklist.py` | Cautious list of names that are not ours to use |
| `cauldron/features.py` | Derives the feature tags from the stat block |
| `cauldron/templates.py` | Abstract `Template` with `EliteTemplate`, plus the damage-type swap |

| `cauldron/seed/` | The SRD importer (`python -m cauldron.seed`): action and spell parsers, damage lines, rule-based tagger, known corrections and the import report |

Raw data and its provenance are in `data/srd-2014/` (see `SOURCE.md` there); the last import report is `data/srd-import-report.md`. The import writes `../frontend/public/data/srd-monsters.json`.

| `cauldron/cr/` | The CR estimator: `measure.py` (effective hit points, armor class, damage per round, offensive bonus), `curves.py` (never-decreasing fit), `calibrate.py` (`python -m cauldron.cr.calibrate`, builds `calibration_table.py` with leave-one-out accuracy), `estimator.py` |

| `cauldron/service/` | The web service. `settings.py` (environment variables), `models.py` (request and response messages), `matching.py`, `store.py` (SQLite: monsters, daily usage, remembered reskins), `limits.py` (rate limiter, daily cap, visitor address), `brief.py` (fills the gaps in a request), `draft.py` and `prompts.py` (what the AI is asked and what it may fill in), `generators.py` (abstract `MonsterGenerator` plus the scripted test one), `service.py` (cache first, then the AI with a retry loop), `app.py` (FastAPI endpoints, CORS) |

The service's endpoints are `GET /api/v1/health`, `GET /api/v1/library`, `POST /api/v1/generate` and `POST /api/v1/reskin`. All settings are environment variables named `CAULDRON_...` (see `settings.py`); the Anthropic key is read only by the Haiku generator from `ANTHROPIC_API_KEY`.

The validator's CR consistency check uses the estimator. The Dungeon Master's Guide table is not in the SRD 5.1, so the estimator is calibrated from the SRD monsters themselves. It is a rough sanity check (see `docs/REQUIREMENTS.md`).

The tests prove two things beyond the unit tests: all 20 sample monsters from the front end load and
round-trip through the Python model, and the Python prose is identical to what the web page prints
(`tests/fixtures/rendered-actions.json` is written by the front end's `crossLanguage.test.ts`).

## Run the SRD import

```bash
cd backend
.venv/Scripts/python -m cauldron.seed
```

## Run

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # on macOS or Linux: .venv/bin/python
.venv/Scripts/python -m pytest
```

Tested on Python 3.15. After an intentional change to the stat block wording, regenerate the shared file with
`npx vitest run -u` in `frontend/`, then run the back end tests.
