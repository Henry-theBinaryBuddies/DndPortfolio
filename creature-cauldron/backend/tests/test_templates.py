"""Tests for reskin helpers: the damage-type swap and the elite template.

The AI may only rename and re-describe a monster. Everything numeric is done here, by code.
"""

import json
from pathlib import Path

import pytest

from cauldron.actions import AttackAction, SaveAction, TextAction
from cauldron.dice import ability_modifier
from cauldron.monster import Monster
from cauldron.options import DamageTheme, DamageType, Source
from cauldron.rules import SRD_ATTRIBUTION, proficiency_bonus, step_cr, xp_for_cr
from cauldron.templates import EliteTemplate, Template, damage_dealt_by, get_template, retarget_name, swap_damage_type
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


def test_damage_dealt_by_lists_what_a_monster_deals_sorted() -> None:
    types = damage_dealt_by(sample("Stormhide Drake"))
    assert types == sorted(types)
    assert DamageType.LIGHTNING in types


def test_what_a_monster_resists_or_is_immune_to_is_not_damage_it_deals() -> None:
    # The SRD zombie deals only bludgeoning but is immune to poison. Swapping "its damage" must not offer poison.
    zombie = sample("Cinderkite").model_copy(
        update={"immunities": [DamageType.POISON], "resistances": [DamageType.COLD], "vulnerabilities": [DamageType.RADIANT]}
    )
    dealt = damage_dealt_by(zombie)
    assert DamageType.POISON not in dealt and DamageType.COLD not in dealt and DamageType.RADIANT not in dealt
    assert dealt  # it still lists the damage its attacks do


def test_damage_named_in_text_actions_counts_as_dealt() -> None:
    from cauldron.actions import MultiattackAction

    breath = TextAction(name="Fire Breath", text="Each creature takes 63 (18d6) fire damage. It then takes 5 (1d10) cold damage from the frost.")
    multi = MultiattackAction(name="Multiattack", sequence=[{"action": "Bite", "count": 1}], text="It makes one bite attack dealing extra necrotic damage.")
    base = sample("Cinderkite").model_copy(update={"actions": [breath, multi], "bonus_actions": [], "reactions": []})
    assert damage_dealt_by(base) == [DamageType.COLD, DamageType.FIRE, DamageType.NECROTIC]


def test_damage_in_a_trait_is_damage_the_monster_takes_not_deals() -> None:
    trait = TextAction(name="Sunlight Sensitivity", text="While in sunlight, the creature takes 5 (1d10) radiant damage at the start of its turn.")
    base = sample("Cinderkite").model_copy(update={"traits": [trait], "actions": [], "bonus_actions": [], "reactions": []})
    assert damage_dealt_by(base) == []


def test_legendary_options_and_reactions_count_as_dealt() -> None:
    from cauldron.monster import LegendaryActions

    legendary = LegendaryActions.model_validate({"per_round": 3, "options": [{"name": "Gaze", "cost": 1, "text": "A creature takes 9 (2d8) psychic damage."}]})
    reaction = TextAction(name="Backlash", text="The attacker takes 4 (1d8) thunder damage.")
    base = sample("Cinderkite").model_copy(update={"actions": [], "bonus_actions": [], "reactions": [reaction], "legendary_actions": legendary})
    assert damage_dealt_by(base) == [DamageType.PSYCHIC, DamageType.THUNDER]


def test_swap_replaces_every_use_of_the_type() -> None:
    base = sample("Stormhide Drake")
    swapped = swap_damage_type(base, DamageType.LIGHTNING, DamageType.COLD)
    assert DamageType.LIGHTNING not in damage_dealt_by(swapped)
    assert DamageType.COLD in damage_dealt_by(swapped)
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


def test_swap_also_rewrites_the_damage_words_inside_text_actions() -> None:
    from cauldron.actions import TextAction

    breath = TextAction(name="Fire Breath", text="The dragon exhales fire. Each creature takes 63 (18d6) fire damage on a failed save.")
    base = sample("Cinderkite").model_copy(update={"actions": [breath]})
    swapped = swap_damage_type(base, DamageType.FIRE, DamageType.COLD)
    assert isinstance(swapped.actions[0], TextAction)
    assert swapped.actions[0].text == "The dragon exhales fire. Each creature takes 63 (18d6) cold damage on a failed save."


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


# --- naming the monster in its own text -----------------------------------------------------------------


def with_text(monster: Monster, name: str, trait: str, action: str) -> Monster:
    return monster.model_copy(
        update={
            "name": name,
            "traits": [TextAction(name="Fortitude", text=trait)],
            "actions": [TextAction(name="Slam", text=action)],
            "bonus_actions": [],
            "reactions": [],
            "legendary_actions": None,
            "spellcasting": None,
        }
    )


def test_text_that_names_the_old_creature_names_the_new_one() -> None:
    zombie = with_text(
        sample("Cinderkite"),
        "Zombie",
        "If damage reduces the zombie to 0 hit points, it makes a save. On a success, the zombie drops to 1 hit point instead.",
        "The zombie hits hard.",
    )
    result = retarget_name(zombie, "Zombie", "Ironbound Revenant")
    assert result.traits[0].text == (
        "If damage reduces the ironbound revenant to 0 hit points, it makes a save. On a success, the ironbound revenant drops to 1 hit point instead."
    )
    assert result.actions[0].text == "The ironbound revenant hits hard."  # type: ignore[union-attr]


def test_a_capitalised_mention_keeps_the_new_names_own_capitals() -> None:
    base = with_text(sample("Cinderkite"), "Zombie", "Zombie tricks.", "x")
    assert retarget_name(base, "Zombie", "Ironbound Revenant").traits[0].text == "Ironbound Revenant tricks."


def test_only_whole_words_are_replaced() -> None:
    base = with_text(sample("Cinderkite"), "Zombie", "Zombies and zombified things stay as they are, but the zombie changes.", "x")
    assert retarget_name(base, "Zombie", "Husk").traits[0].text == "Zombies and zombified things stay as they are, but the husk changes."


def test_a_possessive_is_handled() -> None:
    base = with_text(sample("Cinderkite"), "Zombie", "The zombie's slam.", "x")
    assert retarget_name(base, "Zombie", "Husk").traits[0].text == "The husk's slam."


def test_a_name_with_a_bracket_is_found_by_its_plain_part() -> None:
    base = with_text(sample("Cinderkite"), "Giant Rat (Diseased)", "The giant rat bites.", "x")
    assert retarget_name(base, "Giant Rat (Diseased)", "Plague Gnawer").traits[0].text == "The plague gnawer bites."


def test_every_kind_of_text_is_covered() -> None:
    from cauldron.actions import AttackAction, MultiattackAction, SaveAction
    from cauldron.monster import LegendaryActions

    base = sample("Stormhide Drake")
    old = base.name
    attack = next(a for a in base.actions if isinstance(a, AttackAction)).model_copy(update={"effects_text": f"The {old.lower()} grapples."})
    save = next(a for a in base.actions if isinstance(a, SaveAction)).model_copy(update={"effects_text": f"The {old.lower()} roars."})
    multi = MultiattackAction(name="Multiattack", sequence=[{"action": "Bite", "count": 1}], text=f"The {old.lower()} attacks twice.")
    legendary = LegendaryActions.model_validate({"per_round": 3, "options": [{"name": "Detect", "cost": 1, "text": f"The {old.lower()} looks around."}]})
    prepared = base.model_copy(update={"actions": [attack, save, multi], "legendary_actions": legendary, "traits": [TextAction(name="T", text=f"The {old.lower()} is calm.")]})
    result = retarget_name(prepared, old, "Wavebreaker")
    text = " ".join(
        [t.text for t in result.traits]
        + [a.effects_text or "" for a in result.actions if isinstance(a, (AttackAction, SaveAction))]
        + [a.text or "" for a in result.actions if isinstance(a, MultiattackAction)]
        + [o.text for o in result.legendary_actions.options]  # type: ignore[union-attr]
    )
    assert old.lower() not in text and text.count("wavebreaker") == 5


def test_nothing_changes_when_the_name_is_the_same_or_missing() -> None:
    base = with_text(sample("Cinderkite"), "Zombie", "The zombie waits.", "x")
    assert retarget_name(base, "Zombie", "Zombie") == base
    assert retarget_name(base, "", "Husk") == base


def test_the_original_monster_is_not_changed_by_renaming_its_text() -> None:
    base = with_text(sample("Cinderkite"), "Zombie", "The zombie waits.", "x")
    before = base.model_dump()
    retarget_name(base, "Zombie", "Husk")
    assert base.model_dump() == before


# --- the swap's switch for leaving defences alone --------------------------------------------------------


def test_a_swap_can_leave_the_defences_exactly_as_they_were() -> None:
    base = sample("Cinderkite").model_copy(update={"resistances": [DamageType.FIRE], "immunities": [DamageType.POISON], "vulnerabilities": [DamageType.COLD]})
    swapped = swap_damage_type(base, DamageType.FIRE, DamageType.RADIANT, defences=False)
    assert swapped.resistances == [DamageType.FIRE]  # not rewritten
    assert swapped.immunities == [DamageType.POISON] and swapped.vulnerabilities == [DamageType.COLD]
    assert swap_damage_type(base, DamageType.FIRE, DamageType.RADIANT).resistances == [DamageType.RADIANT]  # the default still follows


def test_the_printed_defence_wording_follows_a_swap_by_default() -> None:
    from cauldron.monster import DamageText

    base = sample("Cinderkite").model_copy(update={"immunities": [DamageType.FIRE], "damage_text": DamageText(immunities="fire; bludgeoning from nonmagical weapons")})
    swapped = swap_damage_type(base, DamageType.FIRE, DamageType.COLD)
    assert swapped.damage_text is not None and swapped.damage_text.immunities == "cold; bludgeoning from nonmagical weapons"
