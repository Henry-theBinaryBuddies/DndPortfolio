"""Measuring a monster: effective hit points, armor class, damage per round and offensive bonus."""

import json
from pathlib import Path

import pytest

from cauldron.actions import AttackAction, TextAction
from cauldron.cr.measure import Measures, measure
from cauldron.monster import DamageText, Monster
from cauldron.seed.importer import import_monster

DATA = Path(__file__).parents[2] / "data" / "srd-2014" / "5e-SRD-Monsters.json"
RAW = {m["index"]: m for m in json.loads(DATA.read_text(encoding="utf-8"))}
SAMPLES = [Monster.model_validate(m) for m in json.loads((Path(__file__).parents[3] / "frontend" / "public" / "data" / "sample-monsters.json").read_text(encoding="utf-8"))]


def srd(index: str) -> Monster:
    return import_monster(RAW[index]).monster


def test_a_goblin() -> None:
    m = measure(srd("goblin"))
    assert isinstance(m, Measures)
    assert m.effective_hp == 7
    assert m.ac == 15
    assert m.dpr == 5  # scimitar and shortbow both average 5
    assert m.offense_bonus == 4


def test_multiattack_adds_up_the_attacks_it_names() -> None:
    # Bite 19 + 7, two claws of 15, and Frightful Presence does no damage: 56. Fire Breath alone is 63.
    m = measure(srd("adult-red-dragon"))
    assert m.dpr == 63


def test_a_multiattack_beats_a_single_attack() -> None:
    # The bandit captain: two scimitar hits of 6 and a dagger hit of 5.
    assert measure(srd("bandit-captain")).dpr == 17


def test_a_text_attack_counts_only_its_hit_damage() -> None:
    # The aboleth's tentacle has a rider about acid every ten minutes, which is not damage in a round.
    aboleth = srd("aboleth")
    assert isinstance(next(a for a in aboleth.actions if a.name == "Tentacle"), AttackAction)
    assert measure(aboleth).dpr == 36  # three tentacles of 12


def test_a_save_action_written_as_text_counts_its_damage() -> None:
    dragon = srd("adult-red-dragon")
    assert any(isinstance(a, TextAction) and "Fire Breath" in a.name for a in dragon.actions)
    assert measure(dragon).dpr == 63


def test_resistance_to_nonmagical_weapons_raises_effective_hit_points() -> None:
    werewolf = srd("werewolf-hybrid")
    assert werewolf.damage_text is not None and "nonmagical" in (werewolf.damage_text.immunities or "")
    assert measure(werewolf).effective_hp == pytest.approx(werewolf.hit_points.average * 1.5)


def test_other_resistances_do_not_change_effective_hit_points() -> None:
    plain = srd("goblin").model_copy(update={"damage_text": DamageText(resistances="damage from spells")})
    assert measure(plain).effective_hp == plain.hit_points.average


def test_a_monster_with_no_damage_has_zero_damage_per_round_and_no_bonus() -> None:
    frog = srd("frog")
    assert measure(frog).dpr == 0
    assert measure(srd("sea-horse")).offense_bonus is None


def test_a_save_dc_counts_as_an_offensive_bonus() -> None:
    # The red dragon's breath is DC 21 and its attacks are +14: the larger counts. A DC counts as DC - 8.
    m = measure(srd("adult-red-dragon"))
    assert m.offense_bonus == 14


@pytest.mark.parametrize("monster", SAMPLES, ids=lambda m: m.name)
def test_every_sample_can_be_measured(monster: Monster) -> None:
    m = measure(monster)
    assert m.effective_hp > 0 and m.ac > 0 and m.dpr >= 0


def test_every_srd_monster_can_be_measured() -> None:
    for index in RAW:
        if index == "half-red-dragon-veteran":
            continue
        m = measure(srd(index))
        assert m.dpr >= 0 and m.effective_hp > 0, index


def test_a_multiattack_that_names_a_plural_or_bracketed_action_still_finds_it() -> None:
    # The Dragon Turtle's multiattack says "Claws" for the action called "Claw"; before, the lookup missed and priced both
    # at the steam breath (52 each) instead of at the claws.
    turtle = measure(srd("dragon-turtle"))
    assert turtle.dpr < 80  # bite 26 + two claws of 16 = 58; with the breath mispriced in it was 130
