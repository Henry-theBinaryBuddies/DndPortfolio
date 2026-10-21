"""Tests for the rules tables. Every table here comes from SRD 5.1 (pages 256 to 258): hit dice by size,
proficiency bonus by challenge rating, and experience points by challenge rating."""

import pytest

from cauldron.options import Size
from cauldron.rules import (
    CR_LABELS,
    SRD_ATTRIBUTION,
    XP_BY_CR,
    cr_value,
    hit_die,
    proficiency_bonus,
    step_cr,
    xp_for_cr,
)


def test_there_are_thirty_four_challenge_ratings_in_order() -> None:
    assert len(CR_LABELS) == 34
    assert CR_LABELS[:6] == ["0", "1/8", "1/4", "1/2", "1", "2"]
    assert CR_LABELS[-1] == "30"
    values = [cr_value(label) for label in CR_LABELS]
    assert values == sorted(values)


def test_cr_value_reads_a_label() -> None:
    assert cr_value("1/8") == 0.125
    assert cr_value("1/2") == 0.5
    assert cr_value("12") == 12


def test_cr_value_rejects_an_unknown_label() -> None:
    with pytest.raises(ValueError):
        cr_value("1/3")


def test_xp_table_matches_the_srd() -> None:
    assert xp_for_cr("0") == 10
    assert xp_for_cr("1/4") == 50
    assert xp_for_cr("5") == 1800
    assert xp_for_cr("17") == 18000
    assert xp_for_cr("30") == 155000
    assert len(XP_BY_CR) == 34  # every challenge rating from 0 to 30, with the four below 1


@pytest.mark.parametrize(
    ("cr", "bonus"),
    [("0", 2), ("1/2", 2), ("4", 2), ("5", 3), ("8", 3), ("9", 4), ("12", 4), ("13", 5), ("16", 5), ("17", 6), ("20", 6), ("21", 7), ("24", 7), ("25", 8), ("28", 8), ("29", 9), ("30", 9)],
)
def test_proficiency_bonus_by_cr(cr: str, bonus: int) -> None:
    assert proficiency_bonus(cr) == bonus


@pytest.mark.parametrize(
    ("size", "die"),
    [(Size.TINY, 4), (Size.SMALL, 6), (Size.MEDIUM, 8), (Size.LARGE, 10), (Size.HUGE, 12), (Size.GARGANTUAN, 20)],
)
def test_hit_die_by_size(size: Size, die: int) -> None:
    assert hit_die(size) == die


def test_step_cr_moves_along_the_ladder() -> None:
    assert step_cr("1/4", 1) == "1/2"
    assert step_cr("1/2", 1) == "1"
    assert step_cr("4", 1) == "5"
    assert step_cr("5", -1) == "4"
    assert step_cr("1/8", -1) == "0"
    assert step_cr("2", 3) == "5"


def test_step_cr_stops_at_the_ends() -> None:
    assert step_cr("30", 1) == "30"
    assert step_cr("0", -1) == "0"


def test_the_srd_attribution_is_the_official_statement() -> None:
    assert SRD_ATTRIBUTION.startswith("This work includes material taken from the System Reference Document 5.1")
    assert "https://dnd.wizards.com/resources/systems-reference-document" in SRD_ATTRIBUTION
    assert SRD_ATTRIBUTION.endswith("https://creativecommons.org/licenses/by/4.0/legalcode.")
