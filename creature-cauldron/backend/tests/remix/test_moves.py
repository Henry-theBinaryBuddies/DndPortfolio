"""The signature moves: eighteen small templates, each building typed actions with numbers worked out by code.

A move is an alternative to one of the monster's attacks, never extra output on top, so none may deal more than the
monster's best single attack. The AI only ever supplies the move's name.
"""

import pytest

from cauldron.actions import AttackAction, SaveAction, TextAction
from cauldron.cr.measure import action_damage
from cauldron.dice import ability_modifier
from cauldron.monster import Monster
from cauldron.options import AreaShape, AttackMode, DamageTheme, DamageType, Size
from cauldron.remix.moves import MOVES, Addition, Move, available_moves, make_context

GROUPS = {"Offence", "Control", "Area", "Defence and mobility"}
ALWAYS = {"dazzle", "dread_presence", "blink_step", "ward_flicker"}  # no damage needed
NEEDS_NOT_TINY = {"pull", "leap"}


def build(move: Move, monster: Monster, theme: DamageTheme = DamageTheme.COLD, name: str = "Test Move") -> Addition:
    return move.build(make_context(monster, theme, name))


def everything(addition: Addition) -> list:
    return [*addition.actions, *addition.bonus_actions, *addition.reactions, *addition.traits]


# --- the menu -------------------------------------------------------------------------------------------


def test_there_are_eighteen_moves_with_unique_keys() -> None:
    assert len(MOVES) == 18
    assert [m.key for m in MOVES.values()] == list(MOVES)


def test_every_move_describes_itself() -> None:
    for move in MOVES.values():
        assert move.label and move.blurb and move.group in GROUPS, move.key


def test_each_group_has_several_moves() -> None:
    counts = {group: sum(m.group == group for m in MOVES.values()) for group in GROUPS}
    assert all(count >= 3 for count in counts.values()), counts


# --- which moves fit which monster ----------------------------------------------------------------------


def test_a_monster_that_deals_no_damage_gets_only_the_moves_that_need_none(named) -> None:
    frog = named("Frog")
    assert {m.key for m in available_moves(frog)} == ALWAYS


def test_a_tiny_monster_cannot_pull_or_leap(named) -> None:
    imp = named("Imp")  # a Tiny fiend that does real damage
    assert imp.size is Size.TINY
    keys = {m.key for m in available_moves(imp)}
    assert not keys & NEEDS_NOT_TINY
    assert {"burst", "rider", "dazzle"} <= keys  # everything else still fits


def test_a_normal_attacker_can_use_every_move(named) -> None:
    assert len(available_moves(named("Ogre"))) == 18


def test_available_moves_are_in_menu_order(named) -> None:
    keys = [m.key for m in available_moves(named("Ogre"))]
    assert keys == list(MOVES)


# --- every move builds something sensible ---------------------------------------------------------------


@pytest.mark.parametrize("key", list(MOVES))
def test_every_move_builds_and_the_monster_stays_valid(key: str, named) -> None:
    ogre = named("Ogre")
    addition = build(MOVES[key], ogre)
    assert everything(addition), key
    assert "Test Move" in addition.summary
    grown = ogre.model_copy(
        update={
            "actions": [*ogre.actions, *addition.actions],
            "bonus_actions": [*ogre.bonus_actions, *addition.bonus_actions],
            "reactions": [*ogre.reactions, *addition.reactions],
            "traits": [*ogre.traits, *addition.traits],
        }
    )
    assert Monster.model_validate(grown.model_dump(mode="json")) == grown


@pytest.mark.parametrize("key", list(MOVES))
def test_every_move_names_its_action_with_the_name_given(key: str, named) -> None:
    addition = build(MOVES[key], named("Ogre"), name="Frostbite Lunge")
    assert all(item.name == "Frostbite Lunge" for item in everything(addition))


def test_text_that_names_the_monster_does_so_in_lower_case_as_the_srd_does(named) -> None:
    ogre = named("Ogre")
    assert "the ogre dies" in build(MOVES["death_burst"], ogre).traits[0].text.replace("When the ogre dies", "the ogre dies")
    assert "the ogre" in build(MOVES["backlash"], ogre).reactions[0].text  # type: ignore[union-attr]
    assert "The ogre teleports" in build(MOVES["blink_step"], ogre).bonus_actions[0].text  # type: ignore[union-attr]
    assert "Ogre" not in " ".join(item.describe("Ogre") for move in MOVES.values() for item in everything(build(move, ogre)))


# --- the numbers ----------------------------------------------------------------------------------------


def best_attack(monster: Monster) -> float:
    return max(action_damage(a) for a in monster.actions if a.kind != "multiattack")


@pytest.mark.parametrize("key", ["rider", "opening_strike", "drain", "lob", "grasping_strike", "sunder", "slowing_touch"])
def test_attack_moves_use_the_monsters_own_attack_bonus_and_theme_damage(key: str, named) -> None:
    ogre = named("Ogre")
    (attack,) = build(MOVES[key], ogre, DamageTheme.ACID).actions
    assert isinstance(attack, AttackAction)
    best_mod = max(ability_modifier(ogre.abilities.str), ability_modifier(ogre.abilities.dex))
    assert attack.attack.to_hit == ogre.challenge.proficiency_bonus + best_mod
    assert attack.damage and all(r.type is DamageType.ACID for r in attack.damage)


@pytest.mark.parametrize("key", list(MOVES))
def test_no_move_deals_more_than_the_monsters_best_attack(key: str, named) -> None:
    for name in ("Ogre", "Goblin", "Adult Red Dragon", "Commoner"):
        monster = named(name)
        best = best_attack(monster)
        for item in everything(build(MOVES[key], monster)):
            assert action_damage(item) <= best + 0.5, (key, name, action_damage(item), best)


@pytest.mark.parametrize("key", ["rider", "grasping_strike", "slowing_touch", "pull", "dazzle", "dread_presence", "leap", "burst", "spray", "death_burst"])
def test_save_dcs_are_8_plus_proficiency_plus_the_best_modifier(key: str, named) -> None:
    ogre = named("Ogre")
    best_mod = max(ability_modifier(getattr(ogre.abilities, a)) for a in ("str", "dex", "con", "int", "wis", "cha"))
    expected = 8 + ogre.challenge.proficiency_bonus + best_mod
    text = " ".join(item.describe(ogre.name) for item in everything(build(MOVES[key], ogre)))
    assert f"DC {expected}" in text


# --- the particular moves -------------------------------------------------------------------------------


def test_a_rider_depends_on_the_theme(named) -> None:
    ogre = named("Ogre")
    expect = {
        DamageTheme.POISON: "poisoned",
        DamageTheme.COLD: "speed halved",
        DamageTheme.LIGHTNING: "unable to take reactions",
        DamageTheme.THUNDER: "deafened",
        DamageTheme.NECROTIC: "unable to regain hit points",
        DamageTheme.RADIANT: "blinded",
        DamageTheme.PSYCHIC: "frightened",
        DamageTheme.FORCE: "knocked prone",
        DamageTheme.ACID: "armor corrodes",
        DamageTheme.FIRE: "catch fire",
    }
    for theme, phrase in expect.items():
        (attack,) = build(MOVES["rider"], ogre, theme).actions
        assert phrase in (attack.effects_text or ""), theme  # type: ignore[union-attr]


def test_grasping_strike_grapples_and_restrains(named) -> None:
    (attack,) = build(MOVES["grasping_strike"], named("Ogre")).actions
    assert "grappled (escape DC" in (attack.effects_text or "") and "restrained" in (attack.effects_text or "")  # type: ignore[union-attr]


def test_lob_is_a_ranged_attack(named) -> None:
    (attack,) = build(MOVES["lob"], named("Ogre")).actions
    assert isinstance(attack, AttackAction) and attack.attack.mode is AttackMode.RANGED_WEAPON
    assert attack.attack.range is not None and attack.attack.range.long > attack.attack.range.normal


def test_burst_is_a_recharging_area_save_that_scales_with_size(named) -> None:
    medium = build(MOVES["burst"], named("Veteran")).actions[0]
    huge = build(MOVES["burst"], named("Adult Red Dragon")).actions[0]
    for save in (medium, huge):
        assert isinstance(save, SaveAction) and save.area is not None and save.recharge is not None
        assert save.area.shape is AreaShape.RADIUS and save.on_success.value == "half"
    assert medium.area.size == 10 and huge.area.size == 20  # type: ignore[union-attr]


def test_spray_is_a_cone(named) -> None:
    (save,) = build(MOVES["spray"], named("Veteran")).actions
    assert isinstance(save, SaveAction) and save.area is not None and save.area.shape is AreaShape.CONE


def test_aura_and_death_burst_are_traits(named) -> None:
    aura = build(MOVES["aura"], named("Ogre"), DamageTheme.FIRE)
    burst = build(MOVES["death_burst"], named("Ogre"), DamageTheme.FIRE)
    for addition in (aura, burst):
        assert len(addition.traits) == 1 and not addition.actions
        assert "fire damage" in addition.traits[0].text
    assert "starts its turn within 10 feet" in aura.traits[0].text
    assert "dies" in burst.traits[0].text and "half as much damage" in burst.traits[0].text


def test_backlash_is_a_reaction(named) -> None:
    addition = build(MOVES["backlash"], named("Ogre"), DamageTheme.THUNDER)
    assert len(addition.reactions) == 1 and not addition.actions
    assert "thunder damage" in addition.reactions[0].text  # type: ignore[union-attr]


def test_blink_step_is_a_recharging_bonus_action_and_ward_flicker_a_reaction(named) -> None:
    blink = build(MOVES["blink_step"], named("Ogre"))
    ward = build(MOVES["ward_flicker"], named("Ogre"))
    assert len(blink.bonus_actions) == 1 and isinstance(blink.bonus_actions[0], TextAction) and blink.bonus_actions[0].recharge is not None
    assert len(ward.reactions) == 1 and "AC" in ward.reactions[0].text  # type: ignore[union-attr]


def test_drain_heals_the_monster(named) -> None:
    (attack,) = build(MOVES["drain"], named("Ogre")).actions
    assert "regains hit points equal to half the damage dealt" in (attack.effects_text or "")  # type: ignore[union-attr]


def test_opening_strike_adds_damage_to_a_target_that_has_not_acted(named) -> None:
    (attack,) = build(MOVES["opening_strike"], named("Ogre"), DamageTheme.RADIANT).actions
    assert "has not yet acted" in (attack.effects_text or "") and "radiant damage" in (attack.effects_text or "")  # type: ignore[union-attr]


def test_the_same_inputs_always_build_the_same_move(named) -> None:
    ogre = named("Ogre")
    for move in MOVES.values():
        assert build(move, ogre) == build(move, ogre)
