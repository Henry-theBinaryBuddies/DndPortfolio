# Creature Cauldron back end

Python models, rules engine, validator and (later) the generator API. Built test-first; the front end in
`../frontend` keeps working without it.

## Status

Part 1 of phase 2 is done: the domain models.

| Module | What it holds |
|---|---|
| `cauldron/options.py` | The fixed option lists (sizes, types, damage types, …) as enums, matching `frontend/src/lib/options.ts` |
| `cauldron/dice.py` | Dice parsing, averages and ability modifiers |
| `cauldron/actions.py` | The action class hierarchy: abstract `Action`, then `AttackAction`, `SaveAction`, `MultiattackAction`, `TextAction`, each writing its own stat block prose |
| `cauldron/monster.py` | `Monster` and its parts, including structured `Spellcasting` and `LegendaryActions` |

The tests prove two things beyond the unit tests: all 20 sample monsters from the front end load and
round-trip through the Python model, and the Python prose is identical to what the web page prints
(`tests/fixtures/rendered-actions.json` is written by the front end's `crossLanguage.test.ts`).

## Run

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"   # on macOS or Linux: .venv/bin/python
.venv/Scripts/python -m pytest
```

Tested on Python 3.15. After an intentional change to the stat block wording, regenerate the shared file with
`npx vitest run -u` in `frontend/`, then run the back end tests.
