"""Tests for the action class hierarchy.

An action is one thing a monster can do. There are four kinds, and each is its own class that knows how to
describe itself in stat block prose. The expected sentences mirror frontend/src/lib/renderAction.ts.
"""

import pytest
from pydantic import TypeAdapter, ValidationError

from cauldron.actions import (
    AnyAction,
    Action,
    AttackAction,
    DamageRoll,
    MultiattackAction,
    Recharge,
    SaveAction,
    TextAction,
)
from cauldron.options import Ability, AttackMode, DamageType, SaveSuccess

ACTION = TypeAdapter(AnyAction)


def bite() -> AttackAction:
    return AttackAction(
        name="Bite",
        attack={"mode": "melee_weapon", "ability": "str", "to_hit": 5, "reach": 5, "targets": "one target"},
        damage=[{"dice": "1d8", "bonus": 3, "type": "piercing"}],
    )


def fire_breath() -> SaveAction:
    return SaveAction(
        name="Fire Breath",
        recharge=Recharge(min=5),
        save={"ability": "dex", "dc": 13},
        area={"shape": "cone", "size": 15},
        on_fail=[{"dice": "6d6", "bonus": 0, "type": "fire"}],
        on_success="half",
    )


# --- the base class -----------------------------------------------------------------------------


def test_the_base_class_cannot_be_used_directly() -> None:
    # Action only defines what every action must be able to do; it is not an action itself.
    with pytest.raises(TypeError):
        Action(name="Nothing")  # type: ignore[abstract]


def test_every_kind_is_an_action() -> None:
    for action in (bite(), fire_breath(), TextAction(name="Pounce", text="It leaps."), MultiattackAction(name="Multiattack", sequence=[{"action": "Bite", "count": 2}])):
        assert isinstance(action, Action)


# --- attacks ------------------------------------------------------------------------------------


def test_attack_prose() -> None:
    assert bite().describe("Wolf") == "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) piercing damage."


def test_attack_with_two_damage_rolls_and_extra_effects() -> None:
    action = AttackAction(
        name="Sting",
        attack={"mode": "melee_weapon", "ability": "dex", "to_hit": 4, "reach": 5, "targets": "one creature"},
        damage=[{"dice": "1d4", "bonus": 2, "type": "piercing"}, {"dice": "2d6", "bonus": 0, "type": "poison"}],
        effects_text="The target is poisoned for 1 minute.",
    )
    assert action.describe("Wasp") == (
        "Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. "
        "Hit: 4 (1d4 + 2) piercing damage plus 7 (2d6) poison damage. The target is poisoned for 1 minute."
    )


def test_attack_with_two_ranges_and_a_negative_bonus() -> None:
    action = AttackAction(
        name="Spit",
        attack={"mode": "ranged_weapon", "ability": "dex", "to_hit": -1, "range": {"normal": 20, "long": 60}, "targets": "one target"},
        damage=[{"dice": "1d4", "bonus": 0, "type": "acid"}],
    )
    assert action.describe("Slime") == "Ranged Weapon Attack: -1 to hit, range 20/60 ft., one target. Hit: 2 (1d4) acid damage."


def test_a_spell_attack_with_one_range_prints_a_single_number() -> None:
    action = AttackAction(
        name="Fire Bolt",
        attack={"mode": "ranged_spell", "ability": "int", "to_hit": 6, "range": {"normal": 120, "long": 120}, "targets": "one target"},
        damage=[{"dice": "2d10", "bonus": 0, "type": "fire"}],
    )
    assert action.describe("Mage") == "Ranged Spell Attack: +6 to hit, range 120 ft., one target. Hit: 11 (2d10) fire damage."


# --- saves --------------------------------------------------------------------------------------


def test_save_with_an_area_and_recharge() -> None:
    action = fire_breath()
    assert action.display_name == "Fire Breath (Recharge 5–6)"
    assert action.describe("Drake") == (
        "Each creature in a 15-foot cone must make a DC 13 Dexterity saving throw, "
        "taking 21 (6d6) fire damage on a failed save, or half as much damage on a successful one."
    )


def test_save_on_one_target_with_no_damage() -> None:
    action = SaveAction(
        name="Stare",
        save={"ability": "wis", "dc": 12},
        on_fail=[],
        on_success="none",
        effects_text="The target is frightened until the end of its next turn.",
    )
    assert action.describe("Seer") == (
        "The target must make a DC 12 Wisdom saving throw. The target is frightened until the end of its next turn."
    )


def test_a_line_area_can_have_a_width() -> None:
    action = SaveAction(
        name="Lightning Breath",
        save={"ability": "dex", "dc": 14},
        area={"shape": "line", "size": 60, "width": 5},
        on_fail=[{"dice": "4d10", "bonus": 0, "type": "lightning"}],
        on_success="half",
    )
    assert "60-foot line that is 5 feet wide" in action.describe("Drake")


def test_recharge_six_has_its_own_label() -> None:
    assert TextAction(name="Roar", text="Loud.", recharge=Recharge(min=6)).display_name == "Roar (Recharge 6)"


# --- multiattack and text -----------------------------------------------------------------------


def test_multiattack_with_one_entry() -> None:
    action = MultiattackAction(name="Multiattack", sequence=[{"action": "Cutlass", "count": 2}])
    assert action.describe("Pirate") == "The pirate makes two cutlass attacks."


def test_multiattack_with_several_entries() -> None:
    action = MultiattackAction(name="Multiattack", sequence=[{"action": "Bite", "count": 1}, {"action": "Claw", "count": 2}])
    assert action.describe("Wyvern") == "The wyvern makes three attacks: one with its bite and two with its claws."


def test_multiattack_text_overrides_the_sequence() -> None:
    action = MultiattackAction(name="Multiattack", sequence=[{"action": "Bite", "count": 1}], text="It does what it likes.")
    assert action.describe("Wyvern") == "It does what it likes."


def test_text_action_is_its_own_prose() -> None:
    assert TextAction(name="Pounce", text="It leaps.").describe("Cat") == "It leaps."


# --- reading actions from JSON ------------------------------------------------------------------


def test_the_kind_field_chooses_the_class() -> None:
    parsed = ACTION.validate_python({"kind": "text", "name": "Pounce", "text": "It leaps."})
    assert type(parsed) is TextAction

    parsed = ACTION.validate_python(bite().model_dump(mode="json"))
    assert type(parsed) is AttackAction


def test_an_unknown_kind_is_rejected() -> None:
    with pytest.raises(ValidationError):
        ACTION.validate_python({"kind": "dance", "name": "Jig"})


def test_dumping_an_action_writes_its_kind_back_out() -> None:
    assert bite().model_dump(mode="json", exclude_none=True)["kind"] == "attack"


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationError):
        ACTION.validate_python({"kind": "text", "name": "Pounce", "text": "It leaps.", "surprise": 1})


@pytest.mark.parametrize("dice", ["lots", "", "2d", "1d6+1d4"])
def test_a_damage_roll_must_have_readable_dice(dice: str) -> None:
    with pytest.raises(ValidationError):
        DamageRoll(dice=dice, bonus=0, type=DamageType.FIRE)


def test_damage_type_must_be_a_known_type() -> None:
    with pytest.raises(ValidationError):
        DamageRoll(dice="1d6", bonus=0, type="sparkle")  # type: ignore[arg-type]


def test_numbers_are_range_checked() -> None:
    with pytest.raises(ValidationError):
        SaveAction(name="X", save={"ability": "dex", "dc": 99}, on_fail=[], on_success="none")
    with pytest.raises(ValidationError):
        MultiattackAction(name="X", sequence=[{"action": "Bite", "count": 0}])
    with pytest.raises(ValidationError):
        TextAction(name="", text="x")


def test_each_kind_can_be_used_through_the_shared_interface() -> None:
    # This is polymorphism: the loop does not care which kind each action is.
    actions: list[Action] = [bite(), fire_breath(), TextAction(name="Pounce", text="It leaps.")]
    assert [a.display_name for a in actions] == ["Bite", "Fire Breath (Recharge 5–6)", "Pounce"]
    assert all(a.describe("Beast") for a in actions)


def test_enums_compare_equal_to_their_plain_strings() -> None:
    assert Ability.STR == "str"
    assert AttackMode.MELEE_WEAPON == "melee_weapon"
    assert SaveSuccess.HALF == "half"
