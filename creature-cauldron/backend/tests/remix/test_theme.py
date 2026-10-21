"""Themes: what a monster's main damage is, and how a new theme changes its damage and its defences."""

import pytest

from cauldron.monster import DamageText, Monster
from cauldron.options import DamageTheme, DamageType
from cauldron.remix.theme import _text_weights, apply_theme, damage_weights, primary_damage, vulnerability_to


# --- the vulnerability table ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("theme", "weakness"),
    [
        (DamageTheme.FIRE, DamageType.COLD),
        (DamageTheme.COLD, DamageType.FIRE),
        (DamageTheme.NECROTIC, DamageType.RADIANT),
        (DamageTheme.RADIANT, DamageType.NECROTIC),
        (DamageTheme.ACID, DamageType.COLD),
        (DamageTheme.POISON, DamageType.RADIANT),
    ],
)
def test_themes_with_a_natural_opposite_have_a_weakness(theme: DamageTheme, weakness: DamageType) -> None:
    assert vulnerability_to(theme) is weakness


@pytest.mark.parametrize("theme", [DamageTheme.LIGHTNING, DamageTheme.THUNDER, DamageTheme.FORCE, DamageTheme.PSYCHIC])
def test_themes_without_a_good_opposite_have_no_weakness(theme: DamageTheme) -> None:
    assert vulnerability_to(theme) is None


def test_a_weakness_is_never_the_theme_itself() -> None:
    for theme in DamageTheme:
        assert vulnerability_to(theme) != DamageType(theme.value)


# --- finding the main damage ----------------------------------------------------------------------------


def test_damage_weights_count_attack_damage_and_text_mentions(named) -> None:
    weights = damage_weights(named("Zombie"))
    assert set(weights) == {DamageType.BLUDGEONING}
    assert weights[DamageType.BLUDGEONING] > 0


def test_the_main_damage_of_a_plain_attacker_is_physical(named) -> None:
    assert primary_damage(named("Zombie")) is DamageType.BLUDGEONING


def test_an_elemental_type_is_preferred_over_physical_damage(named) -> None:
    # A red dragon bites and claws (physical) but its identity is fire.
    assert primary_damage(named("Adult Red Dragon")) is DamageType.FIRE


def test_a_monster_that_deals_no_damage_has_no_main_damage(named) -> None:
    assert primary_damage(named("Frog")) is None


# --- applying a theme -----------------------------------------------------------------------------------


def themed(monster: Monster, theme: DamageTheme):
    return apply_theme(monster, theme)


def test_a_physical_monster_changes_its_main_damage_and_trades_its_old_immunity(named) -> None:
    zombie = named("Zombie")  # deals bludgeoning, is immune to poison
    assert DamageType.POISON in zombie.immunities
    result = themed(zombie, DamageTheme.COLD)
    monster = result.monster
    slam = next(a for a in monster.actions if a.name == "Slam")
    assert slam.damage[0].type is DamageType.COLD  # type: ignore[union-attr]
    assert DamageType.COLD in monster.immunities and DamageType.POISON not in monster.immunities
    assert DamageType.FIRE in monster.vulnerabilities
    assert monster.damage_themes == [DamageTheme.COLD]
    assert result.changes == [
        "Main damage: bludgeoning → cold",
        "Immunity: poison → cold",
        "Now vulnerable to fire",
    ]


def test_an_elemental_monster_keeps_its_physical_attacks(named) -> None:
    dragon = named("Adult Red Dragon")
    monster = themed(dragon, DamageTheme.COLD).monster
    types = {r.type for a in monster.actions if hasattr(a, "damage") for r in a.damage}  # type: ignore[union-attr]
    assert DamageType.COLD in types and DamageType.FIRE not in types
    assert DamageType.PIERCING in types or DamageType.SLASHING in types  # the bite and claws are still physical
    assert "cold damage" in " ".join(getattr(a, "text", "") or "" for a in monster.actions)  # the text breath weapon followed


def test_choosing_the_theme_it_already_has_changes_no_damage(named) -> None:
    dragon = named("Adult Red Dragon")
    result = themed(dragon, DamageTheme.FIRE)
    assert not any(c.startswith("Main damage") for c in result.changes)
    assert DamageType.FIRE in result.monster.immunities  # unchanged
    assert DamageType.COLD in result.monster.vulnerabilities  # but the thematic weakness is still added


def test_a_monster_with_no_old_defence_gains_a_resistance(named) -> None:
    ogre = named("Ogre")
    assert not ogre.immunities and not ogre.resistances
    result = themed(ogre, DamageTheme.ACID)
    assert DamageType.ACID in result.monster.resistances
    assert "Now resists acid" in result.changes
    assert DamageType.COLD in result.monster.vulnerabilities


def test_an_old_resistance_becomes_a_resistance_to_the_new_theme(named) -> None:
    base = named("Ogre").model_copy(update={"resistances": [DamageType.FIRE], "damage_themes": [DamageTheme.FIRE]})
    result = themed(base, DamageTheme.COLD)
    assert result.monster.resistances == [DamageType.COLD]
    assert "Resistance: fire → cold" in result.changes


def test_a_vulnerability_to_the_new_theme_is_removed(named) -> None:
    base = named("Ogre").model_copy(update={"vulnerabilities": [DamageType.COLD]})
    result = themed(base, DamageTheme.COLD)
    assert DamageType.COLD not in result.monster.vulnerabilities
    assert DamageType.COLD in result.monster.resistances


def test_no_weakness_is_added_where_the_monster_is_already_protected_from_it(named) -> None:
    # Cold theme wants a fire weakness, but this monster is immune to fire from something else.
    base = named("Ogre").model_copy(update={"immunities": [DamageType.FIRE]})
    result = themed(base, DamageTheme.COLD)
    assert DamageType.FIRE not in result.monster.vulnerabilities


def test_themes_without_a_weakness_add_none(named) -> None:
    result = themed(named("Ogre"), DamageTheme.LIGHTNING)
    assert result.monster.vulnerabilities == []
    assert not any(c.startswith("Now vulnerable") for c in result.changes)


def test_the_printed_wording_of_a_defence_line_is_kept_in_step(named) -> None:
    base = named("Ogre").model_copy(
        update={
            "resistances": [DamageType.FIRE, DamageType.BLUDGEONING],
            "damage_text": DamageText(resistances="fire; bludgeoning, piercing, and slashing from nonmagical weapons"),
            "damage_themes": [DamageTheme.FIRE],
        }
    )
    monster = themed(base, DamageTheme.COLD).monster
    assert monster.damage_text is not None and monster.damage_text.resistances is not None
    assert "cold" in monster.damage_text.resistances and "fire;" not in monster.damage_text.resistances
    assert "nonmagical weapons" in monster.damage_text.resistances


def test_the_original_monster_is_never_changed(named) -> None:
    zombie = named("Zombie")
    before = zombie.model_dump()
    themed(zombie, DamageTheme.RADIANT)
    assert zombie.model_dump() == before


def test_every_theme_gives_a_valid_monster(named) -> None:
    for theme in DamageTheme:
        for name in ("Zombie", "Adult Red Dragon", "Ogre", "Frog"):
            monster = themed(named(name), theme).monster
            assert Monster.model_validate(monster.model_dump(mode="json")) == monster


def test_every_damage_mention_in_a_text_is_counted_once_whatever_the_order() -> None:
    from collections import defaultdict

    weights: dict[DamageType, float] = defaultdict(float)
    _text_weights("Hit: 1 piercing damage, and the target takes 2 (1d4) poison damage.", weights)  # the Spider's bite
    assert dict(weights) == {DamageType.PIERCING: 1.0, DamageType.POISON: 2.0}
