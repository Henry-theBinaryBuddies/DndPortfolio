"""Tests for reskin helpers: the damage-type swap and the elite template.

The AI may only rename and re-describe a monster. Everything numeric is done here, by code.
"""

import json
from pathlib import Path

import pytest

from cauldron.actions import AttackAction, SaveAction
from cauldron.dice import ability_modifier
from cauldron.monster import Monster
from cauldron.options import DamageTheme, DamageType, Source
from cauldron.rules import SRD_ATTRIBUTION, proficiency_bonus, step_cr, xp_for_cr
from cauldron.templates import EliteTemplate, Template, damage_types_in, get_template, swap_damage_type
from cauldron.validator import Status, Validator

SAMPLES_PATH = Path(__file__).parents[2] / "frontend" / "public" / "data" / "sample-monsters.json"
SAMPLES = [Monster.model_validate(m) for m in json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))]


def sample(name: str) -> Monster:
    return next(m for m in SAMPLES if m.name == name)


def rolls(monster: Monster) -> list:
    found = []
    for action in monster.all_actions():
        if isinstance(action, AttackAction):
            found += action.damage
        if isinstance(action, SaveAction):
            found += action.on_fail
    return found


# --- the damage-type swap -------------------------------------------------------------------------------


def test_damage_types_in_lists_what_a_monster_deals_and_resists_sorted() -> None:
    types = damage_types_in(sample("Stormhide Drake"))
    assert types == sorted(types)
    assert DamageType.LIGHTNING in types


def test_swap_replaces_every_use_of_the_type() -> None:
    base = sample("Stormhide Drake")
    swapped = swap_damage_type(base, DamageType.LIGHTNING, DamageType.COLD)
    assert DamageType.LIGHTNING not in damage_types_in(swapped)
    assert DamageType.COLD in damage_types_in(swapped)
    assert {r.type for r in rolls(swapped)} <= {r.type for r in rolls(base)} - {DamageType.LIGHTNING} | {DamageType.COLD}


def test_swap_leaves_the_original_alone() -> None:
    base = sample("Stormhide Drake")
    before = base.model_dump()
    swap_damage_type(base, DamageType.LIGHTNING, DamageType.COLD)
    assert base.model_dump() == before


def test_swap_does_not_leave_duplicate_resistances() -> None:
    base = sample("Cinderkite").model_copy(update={"resistances": [DamageType.FIRE, DamageType.COLD]})
    assert swap_damage_type(base, DamageType.FIRE, DamageType.COLD).resistances == [DamageType.COLD]


def test_swap_moves_the_damage_theme_or_drops_it_for_a_weapon_type() -> None:
    base = sample("Cinderkite").model_copy(update={"damage_themes": [DamageTheme.FIRE]})
    assert swap_damage_type(base, DamageType.FIRE, DamageType.COLD).damage_themes == [DamageTheme.COLD]
    assert swap_damage_type(base, DamageType.FIRE, DamageType.SLASHING).damage_themes == []


def test_swapping_a_type_for_itself_changes_nothing() -> None:
    base = sample("Stormhide Drake")
    assert swap_damage_type(base, DamageType.FIRE, DamageType.FIRE) == base


# --- templates in general -------------------------------------------------------------------------------


def test_the_base_template_cannot_be_used_directly() -> None:
    with pytest.raises(TypeError):
        Template()  # type: ignore[abstract]


def test_templates_are_found_by_name() -> None:
    assert isinstance(get_template("elite"), EliteTemplate)
    with pytest.raises(KeyError):
        get_template("swarm")


# --- the elite template ---------------------------------------------------------------------------------


def elite(monster: Monster) -> Monster:
    return EliteTemplate().apply(monster)


def test_elite_raises_armor_class_by_one() -> None:
    base = sample("Stormhide Drake")
    assert elite(base).armor_class.value == base.armor_class.value + 1


def test_elite_raises_hit_points_by_about_half_with_matching_dice() -> None:
    base = sample("Stormhide Drake")
    result = elite(base)
    per_die = (10 + 1) / 2 + ability_modifier(base.abilities.con)  # a large creature rolls d10s
    assert abs(result.hit_points.average - base.hit_points.average * 1.5) <= per_die
    assert result.hit_points.dice.startswith(f"{round(result.hit_points.average / per_die)}d10")


def test_elite_raises_challenge_rating_one_step_and_follows_it() -> None:
    base = sample("Stormhide Drake")  # CR 4
    result = elite(base)
    assert result.challenge.cr == "5"
    assert result.challenge.xp == xp_for_cr("5")
    assert result.challenge.proficiency_bonus == proficiency_bonus("5") == 3
    assert result.challenge.cr_value == 5


def test_elite_stops_at_challenge_rating_30() -> None:
    top = sample("Dune Leviathan").model_copy(
        update={"challenge": sample("Dune Leviathan").challenge.model_copy(update={"cr": "30", "cr_value": 30, "xp": 155000, "proficiency_bonus": 9})}
    )
    assert elite(top).challenge.cr == "30"


def test_elite_attacks_hit_harder_and_more_often() -> None:
    base = sample("Cinderkite")
    result = elite(base)
    pb_gain = result.challenge.proficiency_bonus - base.challenge.proficiency_bonus
    for before, after in zip(base.all_actions(), result.all_actions(), strict=True):
        if isinstance(before, AttackAction) and isinstance(after, AttackAction):
            assert after.attack.to_hit == before.attack.to_hit + 1 + pb_gain
            assert [r.bonus for r in after.damage] == [r.bonus + 1 for r in before.damage]


def test_elite_saves_are_harder_and_hurt_more() -> None:
    base = sample("Stormhide Drake")
    result = elite(base)
    pb_gain = result.challenge.proficiency_bonus - base.challenge.proficiency_bonus
    for before, after in zip(base.all_actions(), result.all_actions(), strict=True):
        if isinstance(before, SaveAction) and isinstance(after, SaveAction):
            assert after.save.dc == before.save.dc + 1 + pb_gain
            assert [r.bonus for r in after.on_fail] == [r.bonus + 1 for r in before.on_fail]


def test_when_proficiency_rises_saves_and_skills_rise_with_it() -> None:
    base = sample("Stormhide Drake")
    result = elite(base)
    gain = result.challenge.proficiency_bonus - base.challenge.proficiency_bonus
    assert gain == 1
    assert result.saves == {k: v + gain for k, v in base.saves.items()}
    assert result.skills == {k: v + gain for k, v in base.skills.items()}


def test_elite_spellcasting_numbers_and_intro_follow() -> None:
    base = sample("Hollowvale Hexer")
    result = elite(base)
    assert base.spellcasting is not None and result.spellcasting is not None
    gain = result.challenge.proficiency_bonus - base.challenge.proficiency_bonus
    assert result.spellcasting.dc == base.spellcasting.dc + 1 + gain
    assert result.spellcasting.attack_bonus == base.spellcasting.attack_bonus + 1 + gain
    assert f"spell save DC {result.spellcasting.dc}" in result.spellcasting.intro


def test_elite_is_a_new_unvalidated_reskin_that_keeps_its_attribution() -> None:
    base = sample("Cinderkite").model_copy(update={"source": Source.SRD, "attribution": SRD_ATTRIBUTION})
    result = elite(base)
    assert result.source is Source.RESKIN
    assert result.validated is False
    assert result.parent_id == base.id
    assert result.generator == "template:elite"
    assert result.id != base.id
    assert result.name == "Elite Cinderkite"
    assert result.attribution == SRD_ATTRIBUTION  # a derived work keeps the credit


def test_elite_leaves_the_original_alone() -> None:
    base = sample("Stormhide Drake")
    before = base.model_dump()
    elite(base)
    assert base.model_dump() == before


@pytest.mark.parametrize("monster", SAMPLES, ids=lambda m: m.name)
def test_an_elite_monster_passes_the_validator_without_corrections(monster: Monster) -> None:
    report = Validator().validate(elite(monster))
    assert report.status is Status.ACCEPTED, [f.message for f in report.findings]


def test_two_elites_of_different_monsters_get_different_ids() -> None:
    assert elite(sample("Cinderkite")).id != elite(sample("Stormhide Drake")).id


def test_the_cr_after_elite_is_one_step_up_for_every_sample() -> None:
    for monster in SAMPLES:
        assert elite(monster).challenge.cr == step_cr(monster.challenge.cr, 1)
