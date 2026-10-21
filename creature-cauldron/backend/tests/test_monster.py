"""Tests for the Monster model, using the front end's 20 sample monsters as the shared fixture.

If the Python model and the TypeScript types ever disagree, these fail.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cauldron.monster import Monster, Spellcasting, legendary_intro

SAMPLES_PATH = Path(__file__).parents[2] / "frontend" / "public" / "data" / "sample-monsters.json"
SAMPLES: list[dict] = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))


def without_none(value):
    """A copy with every None removed, so 'missing' and 'null' compare equal (TypeScript's `?:` and `| null`)."""
    if isinstance(value, dict):
        return {k: without_none(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [without_none(v) for v in value]
    return value


def sample(name: str) -> dict:
    return next(m for m in SAMPLES if m["name"] == name)


def test_there_are_twenty_samples() -> None:
    assert len(SAMPLES) == 20


@pytest.mark.parametrize("raw", SAMPLES, ids=lambda m: m["name"])
def test_every_sample_monster_loads_and_round_trips(raw: dict) -> None:
    monster = Monster.model_validate(raw)
    assert without_none(monster.model_dump(mode="json")) == without_none(raw)


def test_an_unknown_field_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Monster.model_validate({**SAMPLES[0], "surprise": True})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("size", "colossal"),
        ("type", "robot"),
        ("role", "healer"),
        ("source", "wizards"),
        ("environments", ["moon"]),
        ("damage_themes", ["slashing"]),
        ("features", ["teleporting"]),
        ("id", ""),
        ("name", ""),
    ],
)
def test_bad_values_are_rejected(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        Monster.model_validate({**SAMPLES[0], field: value})


def test_ability_scores_must_be_1_to_30() -> None:
    for score in (0, 31):
        abilities = {**SAMPLES[0]["abilities"], "str": score}
        with pytest.raises(ValidationError):
            Monster.model_validate({**SAMPLES[0], "abilities": abilities})


def test_a_missing_required_field_is_rejected() -> None:
    raw = dict(SAMPLES[0])
    del raw["hit_points"]
    with pytest.raises(ValidationError):
        Monster.model_validate(raw)


def test_traits_are_text_actions() -> None:
    monster = Monster.model_validate(SAMPLES[0])
    assert all(trait.kind == "text" for trait in monster.traits)


def test_actions_become_the_right_classes() -> None:
    monster = Monster.model_validate(sample("Cinderkite"))
    kinds = {type(a).__name__ for a in monster.actions}
    assert kinds <= {"AttackAction", "SaveAction", "MultiattackAction", "TextAction"}
    assert kinds


def test_spellcasting_is_data_and_writes_the_stat_block_sentence() -> None:
    monster = Monster.model_validate(sample("Hollowvale Hexer"))
    sc = monster.spellcasting
    assert isinstance(sc, Spellcasting)
    assert [level.slots for level in sc.slots] == [4, 3]
    assert sc.to_text() == (
        "The hexer is a 4th-level spellcaster. Its spellcasting ability is Charisma "
        "(spell save DC 13, +5 to hit with spell attacks). Cantrips (at will): minor illusion, poison spray. "
        "1st level (4 slots): charm person, ray of sickness. 2nd level (3 slots): hold person, misty step."
    )
    assert sc.caster_level == 4


def test_innate_spellcasting_text_lists_at_will_before_per_day() -> None:
    sc = Monster.model_validate(sample("Brightwing Sentinel")).spellcasting
    assert sc is not None and sc.innate
    assert sc.to_text().endswith("At will: light, thaumaturgy. 1/day each: lesser restoration, protection from evil and good.")
    assert sc.caster_level is None


def test_spell_notes_are_written_in_brackets() -> None:
    sc = Spellcasting.model_validate(
        {
            "ability": "cha",
            "dc": 15,
            "attack_bonus": 7,
            "innate": True,
            "intro": "It casts these.",
            "cantrips": [],
            "slots": [],
            "at_will": [],
            "per_day": [{"uses": 3, "each": True, "spells": [{"name": "create food and water", "note": "can create wine"}]}],
            "footer": "",
        }
    )
    assert sc.to_text() == "It casts these. 3/day each: create food and water (can create wine)."


def test_legendary_intro_sentence() -> None:
    assert legendary_intro("Ancient Drake", 3).startswith("The ancient drake can take 3 legendary actions, choosing from the options below.")


def test_a_monster_can_list_every_ability_it_has_in_stat_block_order() -> None:
    monster = Monster.model_validate(sample("Cinderkite"))
    names = [a.display_name for a in monster.all_actions()]
    assert names == [a.display_name for a in [*monster.actions, *monster.bonus_actions, *monster.reactions]]


# --- the shared builders --------------------------------------------------------------------------------


def test_a_challenge_block_follows_from_its_label() -> None:
    from cauldron.monster import Challenge

    block = Challenge.for_cr("1/4")
    assert (block.cr, block.cr_value, block.xp, block.proficiency_bonus) == ("1/4", 0.25, 50, 2)
    assert Challenge.for_cr("17").proficiency_bonus == 6
    with pytest.raises(ValueError):
        Challenge.for_cr("31")


def test_hit_points_from_dice_add_the_constitution_modifier_to_every_die() -> None:
    from cauldron.monster import HitPoints

    assert HitPoints.for_dice(4, 8, 2) == HitPoints(dice="4d8+8", average=26)
    assert HitPoints.for_dice(2, 4, -3).average == 1  # never below 1 hit point


def test_map_actions_reaches_the_actions_the_bonus_actions_and_the_reactions() -> None:
    from cauldron.actions import TextAction

    monster = Monster.model_validate(sample("Stormhide Drake"))
    reaction = TextAction(name="Backlash", text="It strikes back.")
    monster = monster.model_copy(update={"bonus_actions": [reaction], "reactions": [reaction]})
    renamed = monster.map_actions(lambda a: a.model_copy(update={"name": a.name.upper()}))
    assert [a.name for a in renamed.all_actions()] == [a.name.upper() for a in monster.all_actions()]
    assert renamed.bonus_actions[0].name == "BACKLASH" and renamed.reactions[0].name == "BACKLASH"
    assert monster.reactions[0].name == "Backlash"  # the original is untouched
