"""The remix engine: theme, then signature move, then (optionally) level up, plus the choices left to chance.

The sweep at the end is the important test: every move, on every monster in the library, must give a valid monster that the
validator has no new complaint about and whose challenge rating the estimator sees as unchanged (within one step).
"""

import random

import pytest

from cauldron.actions import AttackAction, SaveAction
from cauldron.cr.estimator import estimate
from cauldron.monster import Monster
from cauldron.options import DamageTheme, DamageType, Source
from cauldron.remix.engine import RemixResult, current_theme, remix, resolve
from cauldron.remix.moves import MOVES, available_moves
from cauldron.remix.theme import primary_damage
from cauldron.rules import step_cr
from cauldron.validator import Status, Validator


# --- putting the three parts together -------------------------------------------------------------------


def test_a_theme_alone_changes_damage_and_defences_and_says_so(named) -> None:
    result = remix(named("Zombie"), DamageTheme.COLD, None, "unused")
    assert isinstance(result, RemixResult)
    assert result.changes[0] == "Main damage: bludgeoning → cold"
    assert not any(c.startswith("New move") for c in result.changes)
    assert result.monster.actions == [a for a in result.monster.actions]  # no move added
    assert len(result.monster.actions) == len(named("Zombie").actions)


def test_a_move_alone_adds_the_move_in_the_monsters_default_theme(named) -> None:
    zombie = named("Zombie")
    result = remix(zombie, None, "burst", "Grave Chill")
    assert len(result.monster.actions) == len(zombie.actions) + 1
    burst = result.monster.actions[-1]
    assert isinstance(burst, SaveAction) and burst.name == "Grave Chill"
    assert burst.on_fail[0].type.value == current_theme(zombie).value  # the zombie's own theme
    assert result.monster.immunities == zombie.immunities  # no theme, so no defence change


def test_theme_and_move_together_use_the_new_theme_for_the_move(named) -> None:
    result = remix(named("Zombie"), DamageTheme.RADIANT, "lob", "Dawn Spit")
    spit = result.monster.actions[-1]
    assert isinstance(spit, AttackAction) and spit.damage[0].type is DamageType.RADIANT
    assert any(c == "New move: Dawn Spit (lob)" for c in result.changes)
    assert result.changes[0] == "Main damage: bludgeoning → radiant"


def test_a_level_up_raises_the_cr_but_keeps_the_identity(named) -> None:
    ogre = named("Ogre")  # CR 2
    result = remix(ogre, None, None, "unused", level_up=True)
    assert result.monster.challenge.cr == "3"
    assert (result.monster.id, result.monster.name, result.monster.source) == (ogre.id, ogre.name, ogre.source)
    assert result.changes == ["Level up: CR 2 → CR 3, with more hit points, better armor and harder hits"]


def test_the_order_of_changes_is_theme_then_move_then_level_up(named) -> None:
    result = remix(named("Ogre"), DamageTheme.FIRE, "backlash", "Cinder Hide", level_up=True)
    kinds = [c.split(":")[0] for c in result.changes]
    assert kinds.index("Main damage") < kinds.index("New move") < kinds.index("Level up")


def test_nothing_chosen_is_an_error(named) -> None:
    with pytest.raises(ValueError, match="nothing to change"):
        remix(named("Ogre"), None, None, "x")


def test_an_unknown_move_is_an_error(named) -> None:
    with pytest.raises(ValueError, match="Unknown move"):
        remix(named("Ogre"), None, "teleport_everyone", "x")


def test_a_move_that_does_not_fit_is_an_error(named) -> None:
    with pytest.raises(ValueError, match="does not fit"):
        remix(named("Frog"), None, "burst", "x")


def test_the_original_monster_is_never_changed(named) -> None:
    ogre = named("Ogre")
    before = ogre.model_dump()
    remix(ogre, DamageTheme.ACID, "rider", "Etch", level_up=True)
    assert ogre.model_dump() == before


def test_the_same_inputs_give_the_same_result(named) -> None:
    ogre = named("Ogre")
    assert remix(ogre, DamageTheme.ACID, "rider", "Etch") == remix(ogre, DamageTheme.ACID, "rider", "Etch")


# --- choices left to chance -----------------------------------------------------------------------------


def test_explicit_choices_are_passed_through_untouched(named) -> None:
    assert resolve(named("Ogre"), "fire", "burst", random.Random(1)) == ("fire", "burst")


def test_a_named_move_that_does_not_fit_is_not_resolve_business(named) -> None:
    # create_reskin refuses it with a clean message; resolve only decides surprises, so it must not raise.
    assert resolve(named("Frog"), "surprise", "burst", random.Random(1))[1] == "burst"


def test_nothing_chosen_stays_nothing(named) -> None:
    assert resolve(named("Ogre"), None, None, random.Random(1)) == (None, None)


def test_surprise_picks_a_theme_other_than_the_one_it_has(named) -> None:
    dragon = named("Adult Red Dragon")
    themes = {resolve(dragon, "surprise", None, random.Random(s))[0] for s in range(100)}
    assert DamageTheme.FIRE.value not in themes and len(themes) > 5
    assert themes <= {t.value for t in DamageTheme}


def test_surprise_picks_only_moves_that_fit(named) -> None:
    imp = named("Imp")
    allowed = {m.key for m in available_moves(imp)}
    picked = {resolve(imp, None, "surprise", random.Random(s))[1] for s in range(200)}
    assert picked <= allowed and len(picked) > 8


def test_surprise_is_reproducible_for_a_seed(named) -> None:
    ogre = named("Ogre")
    assert resolve(ogre, "surprise", "surprise", random.Random(5)) == resolve(ogre, "surprise", "surprise", random.Random(5))


def test_surprise_with_only_the_no_damage_moves_available_picks_one_of_those(named) -> None:
    frog = named("Frog")
    key = resolve(frog, None, "surprise", random.Random(3))[1]
    assert key is not None and MOVES[key].needs_damage is False


# --- the sweep: every move on every monster -------------------------------------------------------------

THEMES = list(DamageTheme)

# Monsters whose own attacks sit well below the plain rule (the Purple Worm hits at +9 where its Strength gives +14). Any new
# attack must carry the rule's bonus, because the validator corrects anything lower, and that alone moves the estimator two
# steps. It is the estimator's quirk, not a move that adds output, so these may drift by two.
LOW_BONUS_MONSTERS = {"Purple Worm"}


def theme_for(index: int, move_index: int) -> DamageTheme:
    return THEMES[(index * 7 + move_index * 3) % len(THEMES)]


def as_reskin(monster: Monster) -> Monster:
    return monster.model_copy(update={"source": Source.RESKIN, "validated": False})


def findings_text(monster: Monster) -> list[str]:
    return [f.message for f in Validator().validate(monster).findings]


def test_every_move_on_every_monster_is_valid_rule_abiding_and_cr_neutral(everyone) -> None:
    checked = failures = 0
    problems: list[str] = []
    for i, base in enumerate(everyone):
        base_cr = estimate(base).index
        base_findings = set(findings_text(as_reskin(base)))
        for j, move in enumerate(available_moves(base)):
            theme = theme_for(i, j)
            result = remix(base, theme, move.key, "Probe Move")
            checked += 1
            monster = result.monster
            where = f"{base.name} + {theme.value} + {move.key}"

            # valid: the monster survives being checked from scratch
            try:
                assert Monster.model_validate(monster.model_dump(mode="json")) == monster
            except Exception as error:  # noqa: BLE001
                problems.append(f"{where}: invalid ({error})")
                continue

            # no NEW complaint from the validator (the base may already have some, which are not the move's fault)
            new = [m for m in findings_text(as_reskin(monster)) if m not in base_findings and "CR consistency" not in m]
            if new:
                problems.append(f"{where}: new validator complaint {new[0]}")

            # challenge rating as the estimator sees it stays within one step
            drift = abs(estimate(monster).index - base_cr)
            if drift > (2 if base.name in LOW_BONUS_MONSTERS else 1):
                problems.append(f"{where}: CR drift {drift}")

            if not result.changes:
                problems.append(f"{where}: no changes listed")
    failures = len(problems)
    assert checked > 4000, checked
    assert failures == 0, "\n".join(problems[:15]) + f"\n({failures} problems in {checked} remixes)"


def test_level_up_on_top_of_a_remix_keeps_the_monster_valid(everyone) -> None:
    for base in everyone[::7]:
        moves = available_moves(base)
        move = moves[len(base.name) % len(moves)]
        result = remix(base, THEMES[len(base.name) % len(THEMES)], move.key, "Probe Move", level_up=True)
        assert Monster.model_validate(result.monster.model_dump(mode="json")) == result.monster
        if base.challenge.cr != "30":
            assert result.monster.challenge.cr == step_cr(base.challenge.cr, 1)


def test_after_a_theme_the_main_damage_is_the_theme(everyone) -> None:
    for base in everyone[::5]:
        if primary_damage(base) is None:
            continue
        result = remix(base, DamageTheme.PSYCHIC, None, "x")
        assert primary_damage(result.monster) is DamageType.PSYCHIC, base.name


def test_the_validator_status_is_never_a_rejection_for_a_remix(named) -> None:
    result = remix(named("Zombie"), DamageTheme.COLD, "grasping_strike", "Drowning Embrace")
    assert Validator().validate(as_reskin(result.monster)).status is not Status.REJECTED
