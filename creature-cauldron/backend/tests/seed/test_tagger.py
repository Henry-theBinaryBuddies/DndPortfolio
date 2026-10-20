"""The rule-based tagger: environments, role and damage themes for imported monsters.

These tags only help people find monsters. They are rule-based guesses, and the docs say so. The tests pin the
rules down so a change to them is deliberate.
"""

import json
from pathlib import Path

import pytest

from cauldron.monster import Monster
from cauldron.options import CreatureType, DamageTheme, Environment, Role
from cauldron.seed.tagger import tag

SAMPLES = [Monster.model_validate(m) for m in json.loads((Path(__file__).parents[3] / "frontend" / "public" / "data" / "sample-monsters.json").read_text(encoding="utf-8"))]


def sample(name: str) -> Monster:
    return next(m for m in SAMPLES if m.name == name)


def named(monster: Monster, name: str, **update) -> Monster:
    return monster.model_copy(update={"name": name, **update})


BASE = sample("Gloomcap Shambler")


def test_name_keywords_choose_environments() -> None:
    assert Environment.ARCTIC in tag(named(BASE, "Adult White Dragon", type=CreatureType.DRAGON)).environments
    assert Environment.UNDERWATER in tag(named(BASE, "Giant Shark", type=CreatureType.BEAST)).environments
    assert Environment.DESERT in tag(named(BASE, "Camel", type=CreatureType.BEAST)).environments
    assert Environment.FOREST in tag(named(BASE, "Dire Wolf", type=CreatureType.BEAST)).environments


def test_the_creature_type_is_the_fallback() -> None:
    result = tag(named(BASE, "Nameless Thing", type=CreatureType.UNDEAD))
    assert Environment.DUNGEON in result.environments
    assert Environment.PLANAR in tag(named(BASE, "Nameless Thing", type=CreatureType.CELESTIAL)).environments


def test_there_are_between_one_and_three_environments() -> None:
    for monster in SAMPLES:
        assert 1 <= len(tag(monster).environments) <= 3, monster.name


def test_a_creature_that_swims_faster_than_it_walks_lives_underwater() -> None:
    swimmer = BASE.model_copy(update={"name": "Odd Fish", "speeds": BASE.speeds.model_copy(update={"walk": 5, "swim": 40})})
    assert Environment.UNDERWATER in tag(swimmer).environments


def test_environments_have_no_repeats() -> None:
    for monster in SAMPLES:
        envs = tag(monster).environments
        assert len(envs) == len(set(envs)), monster.name


# --- roles ----------------------------------------------------------------------------------------------


def test_legendary_creatures_are_solos() -> None:
    assert tag(sample("Voidbloom Seer")).role is Role.SOLO


def test_casters_are_controllers_when_they_are_not_solos() -> None:
    assert tag(sample("Hollowvale Hexer")).role is Role.CONTROLLER


def test_every_monster_gets_a_valid_role() -> None:
    for monster in SAMPLES:
        assert tag(monster).role in set(Role)


def test_tagging_is_deterministic() -> None:
    assert tag(sample("Stormhide Drake")) == tag(sample("Stormhide Drake"))


# --- damage themes --------------------------------------------------------------------------------------


def test_damage_themes_are_the_elements_a_monster_deals_or_is_immune_to() -> None:
    drake = tag(sample("Stormhide Drake"))
    assert DamageTheme.LIGHTNING in drake.damage_themes


def test_weapon_damage_is_never_a_theme() -> None:
    for monster in SAMPLES:
        assert all(t.value not in {"slashing", "piercing", "bludgeoning"} for t in tag(monster).damage_themes)


def test_themes_are_unique_and_at_most_three() -> None:
    for monster in SAMPLES:
        themes = tag(monster).damage_themes
        assert len(themes) == len(set(themes)) <= 3, monster.name


@pytest.mark.parametrize("monster", SAMPLES, ids=lambda m: m.name)
def test_tags_are_all_valid_enum_members(monster: Monster) -> None:
    result = tag(monster)
    assert all(isinstance(e, Environment) for e in result.environments)
    assert all(isinstance(t, DamageTheme) for t in result.damage_themes)
