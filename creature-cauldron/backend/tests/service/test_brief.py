"""The brief: the request with every gap filled in (at random, but reproducibly), ready to be turned into a prompt."""

import random

import pytest

from cauldron.options import CreatureType, DamageTheme, Environment, Feature, Role, Size
from cauldron.rules import CR_LABELS, cr_value
from cauldron.service.brief import Brief, build_brief, effective_bounds
from cauldron.service.models import GenerateRequest


def req(**fields) -> GenerateRequest:
    return GenerateRequest.model_validate(fields)


# --- the challenge rating range -------------------------------------------------------------------------


def test_with_no_bounds_the_range_is_zero_to_the_cap() -> None:
    assert effective_bounds(req(), "17") == (0.0, 17.0)


def test_bounds_are_clamped_to_the_cap() -> None:
    assert effective_bounds(req(crMin=3, crMax=30), "17") == (3.0, 17.0)
    assert effective_bounds(req(crMin=2), "10") == (2.0, 10.0)


def test_a_range_wholly_above_the_cap_is_empty() -> None:
    assert effective_bounds(req(crMin=18), "17") is None


def test_a_range_inside_the_cap_is_unchanged() -> None:
    assert effective_bounds(req(crMin=1, crMax=4), "17") == (1.0, 4.0)


# --- building a brief -----------------------------------------------------------------------------------


def test_the_challenge_rating_is_inside_the_range_and_under_the_cap() -> None:
    for seed in range(200):
        brief = build_brief(req(crMin=3, crMax=5), "17", random.Random(seed))
        assert 3 <= cr_value(brief.cr) <= 5
    for seed in range(200):
        assert cr_value(build_brief(req(), "10", random.Random(seed)).cr) <= 10


def test_every_challenge_rating_in_the_range_can_be_chosen() -> None:
    chosen = {build_brief(req(crMin=0, crMax=1), "17", random.Random(s)).cr for s in range(300)}
    assert chosen == {"0", "1/8", "1/4", "1/2", "1"}


def test_choices_come_from_what_was_picked() -> None:
    for seed in range(100):
        brief = build_brief(
            req(types=["undead", "fiend"], sizes=["large"], environments=["swamp"], roles=["lurker"], damageThemes=["necrotic"]),
            "17",
            random.Random(seed),
        )
        assert brief.type in (CreatureType.UNDEAD, CreatureType.FIEND)
        assert (brief.size, brief.environment, brief.role, brief.damage_theme) == (Size.LARGE, Environment.SWAMP, Role.LURKER, DamageTheme.NECROTIC)


def test_gaps_are_filled_from_the_full_lists_so_results_vary() -> None:
    briefs = [build_brief(req(), "17", random.Random(s)) for s in range(300)]
    assert {b.type for b in briefs} == set(CreatureType)
    assert {b.size for b in briefs} == set(Size)
    assert {b.environment for b in briefs} == set(Environment)
    assert {b.role for b in briefs} == set(Role)
    assert None in {b.damage_theme for b in briefs} and any(b.damage_theme for b in briefs)


def test_requested_features_are_all_kept() -> None:
    brief = build_brief(req(features=["flying", "legendary"]), "17", random.Random(1))
    assert set(brief.features) == {Feature.FLYING, Feature.LEGENDARY}


def test_the_same_seed_gives_the_same_brief() -> None:
    assert build_brief(req(), "17", random.Random(7)) == build_brief(req(), "17", random.Random(7))


def test_different_seeds_give_different_briefs() -> None:
    assert len({build_brief(req(), "17", random.Random(s)) for s in range(30)}) > 5


def test_an_empty_range_cannot_make_a_brief() -> None:
    with pytest.raises(ValueError):
        build_brief(req(crMin=20), "17", random.Random(1))


def test_a_brief_describes_itself_in_one_line_for_the_logs() -> None:
    text = str(build_brief(req(types=["dragon"], sizes=["huge"], environments=["mountain"], roles=["solo"], damageThemes=["fire"], features=["flying"], crMin=8, crMax=8), "17", random.Random(1)))
    assert text == "CR 8 huge dragon, mountain, solo, damage theme fire, features flying"
    assert "damage theme none, features none" in str(Brief("1", CreatureType.BEAST, Size.SMALL, Environment.FOREST, Role.BRUTE, None, ()))


def test_a_brief_is_plain_data() -> None:
    brief = build_brief(req(), "17", random.Random(1))
    assert isinstance(brief, Brief) and brief.cr in CR_LABELS
