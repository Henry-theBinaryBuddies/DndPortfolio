"""The Python model must print the same stat block wording as the web page.

tests/fixtures/rendered-actions.json is written by the front end's crossLanguage.test.ts from the TypeScript
renderer. Here the Python classes render every sample monster and the result must match it exactly.
"""

import json
from pathlib import Path

import pytest

from cauldron.monster import Monster, legendary_intro

HERE = Path(__file__).parent
SAMPLES = json.loads((HERE.parents[1] / "frontend" / "public" / "data" / "sample-monsters.json").read_text(encoding="utf-8"))
GOLDEN = json.loads((HERE / "fixtures" / "rendered-actions.json").read_text(encoding="utf-8"))


def test_the_golden_file_covers_every_sample() -> None:
    assert [g["name"] for g in GOLDEN] == [m["name"] for m in SAMPLES]


@pytest.mark.parametrize("expected", GOLDEN, ids=lambda g: g["name"])
def test_python_prose_matches_the_web_page(expected: dict) -> None:
    monster = Monster.model_validate(next(m for m in SAMPLES if m["name"] == expected["name"]))

    produced = []
    for section, actions in [
        ("trait", monster.traits),
        ("action", monster.actions),
        ("bonus_action", monster.bonus_actions),
        ("reaction", monster.reactions),
    ]:
        for action in actions:
            produced.append(
                {"section": section, "display_name": action.display_name, "prose": action.describe(monster.name)}
            )
    assert produced == expected["entries"]

    spellcasting = monster.spellcasting.to_text() if monster.spellcasting else None
    assert spellcasting == expected["spellcasting"]

    legendary = (
        legendary_intro(monster.name, monster.legendary_actions.per_round) if monster.legendary_actions else None
    )
    assert legendary == expected["legendary_intro"]
