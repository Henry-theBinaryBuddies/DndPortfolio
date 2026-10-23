"""Tests for the dice and ability arithmetic.

These mirror frontend/src/lib/dice.ts, so both sides print the same numbers.
"""

import pytest

from cauldron.dice import (
    ParsedDice,
    ability_modifier,
    average_dice,
    format_damage_roll,
    format_signed,
    parse_dice,
)


@pytest.mark.parametrize(
    ("score", "modifier"),
    [(1, -5), (8, -1), (9, -1), (10, 0), (11, 0), (12, 1), (15, 2), (20, 5), (30, 10)],
)
def test_ability_modifier(score: int, modifier: int) -> None:
    assert ability_modifier(score) == modifier


def test_format_signed() -> None:
    assert format_signed(4) == "+4"
    assert format_signed(0) == "+0"
    assert format_signed(-1) == "-1"


def test_parse_dice_reads_count_sides_and_bonus() -> None:
    assert parse_dice("2d6") == ParsedDice(count=2, sides=6, bonus=0)
    assert parse_dice("4d8+8") == ParsedDice(count=4, sides=8, bonus=8)
    assert parse_dice("1d6 - 1") == ParsedDice(count=1, sides=6, bonus=-1)
    assert parse_dice("  3d10  ") == ParsedDice(count=3, sides=10, bonus=0)


@pytest.mark.parametrize("bad", ["", "d6", "2d", "2x6", "2d6+", "two dice", "2d6+1d4", "-1d6"])
def test_parse_dice_rejects_anything_else(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_dice(bad)


def test_average_rounds_down_like_a_printed_stat_block() -> None:
    assert average_dice("2d6") == 7
    assert average_dice("1d4", 3) == 5  # 2.5 + 3 = 5.5, printed as 5
    assert average_dice("4d8+8") == 26
    assert average_dice("1d6 - 1") == 2


def test_format_damage_roll() -> None:
    assert format_damage_roll("1d6", 0) == "3 (1d6)"
    assert format_damage_roll("2d6", 2) == "9 (2d6 + 2)"
    assert format_damage_roll("1d6", -1) == "2 (1d6 - 1)"
