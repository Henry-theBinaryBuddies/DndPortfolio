"""Damage lines: the plain type lists, and the printed wording kept when a list cannot express it."""

from cauldron.options import DamageType
from cauldron.seed.damage import parse_damage_line


def test_plain_types_become_a_list_with_no_text() -> None:
    types, text = parse_damage_line(["fire", "cold"])
    assert types == [DamageType.FIRE, DamageType.COLD]
    assert text is None


def test_an_empty_line_is_empty() -> None:
    assert parse_damage_line([]) == ([], None)


def test_a_qualified_line_keeps_its_types_and_its_exact_wording() -> None:
    types, text = parse_damage_line(["bludgeoning, piercing, and slashing from nonmagical weapons"])
    assert types == [DamageType.BLUDGEONING, DamageType.PIERCING, DamageType.SLASHING]
    assert text == "bludgeoning, piercing, and slashing from nonmagical weapons"


def test_plain_and_qualified_entries_together_are_printed_in_order() -> None:
    types, text = parse_damage_line(["poison", "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered"])
    assert types == [DamageType.POISON, DamageType.BLUDGEONING, DamageType.PIERCING, DamageType.SLASHING]
    assert text == "poison; bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered"


def test_damage_from_spells_has_no_type_but_keeps_its_text() -> None:
    types, text = parse_damage_line(["damage from spells"])
    assert types == []
    assert text == "damage from spells"


def test_a_type_is_listed_once() -> None:
    types, _ = parse_damage_line(["piercing", "piercing and slashing from nonmagical weapons"])
    assert types == [DamageType.PIERCING, DamageType.SLASHING]
