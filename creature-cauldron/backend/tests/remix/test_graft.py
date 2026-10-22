"""Polymorph, graft mode: what a donor can lend, how it is fitted to the base, and that thousands of pairs stay in shape."""

import random

import pytest

from cauldron.cr.estimator import estimate
from cauldron.dice import average_dice
from cauldron.monster import Monster
from cauldron.options import Source
from cauldron.remix.graft import MAX_BORROW, borrowable, graft
from cauldron.remix.moves import best_attack
from cauldron.validator import Validator


def keys(base: Monster, donor: Monster) -> list[str]:
    return [b.key for b in borrowable(base, donor)]


# --- what a donor can lend --------------------------------------------------------------------------------


def test_a_flying_donor_lends_flight_to_a_walker(named) -> None:
    offered = {b.key: b for b in borrowable(named("Wolf"), named("Giant Eagle"))}
    assert offered["speed:fly"].label == "Fly 80 ft." and offered["speed:fly"].kind == "movement"


def test_a_donor_does_not_lend_what_the_base_already_has_at_least_as_well(named) -> None:
    assert "speed:fly" not in keys(named("Giant Eagle"), named("Giant Eagle").model_copy(update={"id": "copy"}))
    assert "speed:fly" not in keys(named("Giant Eagle"), named("Wolf"))


def test_senses_traits_attacks_and_main_damage_are_listed_with_their_kinds(named) -> None:
    offered = {b.key: b for b in borrowable(named("Goblin"), named("Adult Red Dragon"))}
    assert offered["sense:blindsight"].label == "Blindsight 60 ft."
    assert offered["damage"].label == "Main damage: fire, with its defences"
    assert offered["attack:Fire Breath"].label == "Fire Breath (fire, area save)"  # an SRD breath weapon is text, and is lent too
    assert offered["attack:Bite"].kind == "attack" and offered["attack:Bite"].label == "Bite (piercing/fire, melee attack)"
    assert "attack:Claw" in offered and "attack:Tail" in offered
    assert any(b.key == "trait:Keen Sight" for b in borrowable(named("Wolf"), named("Giant Eagle")))


def test_rule_carrying_traits_are_never_lent(named) -> None:
    lent = keys(named("Goblin"), named("Adult Red Dragon"))
    assert not any(k.lower().startswith(("trait:legendary resistance", "trait:spellcasting")) for k in lent)


def test_an_attack_the_base_already_has_is_not_offered_even_in_the_plural(named) -> None:
    lent = keys(named("Adult Red Dragon"), named("Ghoul"))
    assert "attack:Claws" not in lent  # the dragon has "Claw"; the two would be priced as one by the CR measure


def test_a_base_that_deals_no_damage_is_offered_no_attacks(named) -> None:
    lent = keys(named("Frog"), named("Wolf"))
    assert not any(k.startswith("attack:") for k in lent)


# --- fitting the borrowed pieces --------------------------------------------------------------------------


def test_the_base_keeps_its_own_hit_points_armor_abilities_and_attacks(named) -> None:
    base, donor = named("Goblin"), named("Adult Red Dragon")
    result = graft(base, donor, ["attack:Fire Breath", "speed:fly"])
    monster = result.monster
    assert monster.hit_points == base.hit_points and monster.armor_class == base.armor_class and monster.abilities == base.abilities
    assert [a for a in monster.actions if a.name in {x.name for x in base.actions}] == base.actions
    assert monster.speeds.fly == donor.speeds.fly and monster.speeds.walk == base.speeds.walk


def test_a_borrowed_attack_is_rolled_to_the_bases_budget_and_uses_the_bases_numbers(named) -> None:
    base, donor = named("Goblin"), named("Adult Red Dragon")
    monster = graft(base, donor, ["attack:Bite", "attack:Fire Breath"]).monster
    bite = next(a for a in monster.actions if a.name == "Bite")
    breath = next(a for a in monster.actions if a.name == "Fire Breath")
    own_bonus = base.challenge.proficiency_bonus + max(0, (base.abilities.dex - 10) // 2, (base.abilities.str - 10) // 2)
    assert bite.attack.to_hit == own_bonus  # the dragon's +11 becomes the goblin's own bonus
    assert sum(average_dice(r.dice, r.bonus) for r in bite.damage) <= best_attack(base)  # never above the goblin's best attack
    assert "DC 21" not in breath.text and "63 (18d6)" not in breath.text  # the dragon's DC and damage are gone
    assert Monster.model_validate(monster.model_dump(mode="json")) == monster


def test_borrowed_text_speaks_of_the_base_and_not_the_donor(named) -> None:
    base, donor = named("Goblin"), named("Zombie")
    monster = graft(base, donor, ["trait:Undead Fortitude"]).monster
    text = next(t.text for t in monster.traits if t.name == "Undead Fortitude")
    assert "the goblin" in text and "the zombie" not in text
    breath = next(a for a in graft(base, named("Adult Red Dragon"), ["attack:Fire Breath"]).monster.actions if a.name == "Fire Breath")
    assert "dragon" not in breath.text.lower() and breath.text.startswith("The goblin exhales")


def test_the_main_damage_comes_with_its_defences(named) -> None:
    monster = graft(named("Goblin"), named("Adult Red Dragon"), ["damage"]).monster
    assert monster.damage_themes and monster.damage_themes[0].value == "fire"
    assert "fire" in [t.value for t in monster.immunities + monster.resistances]


def test_a_level_up_is_optional_and_adds_a_step(named) -> None:
    base, donor = named("Goblin"), named("Giant Eagle")
    plain = graft(base, donor, ["speed:fly"])
    higher = graft(base, donor, ["speed:fly"], level_up=True)
    assert plain.monster.challenge.cr == base.challenge.cr
    assert higher.monster.challenge.cr != base.challenge.cr and any(c.startswith("Level up") for c in higher.changes)


def test_the_changes_say_what_was_borrowed_and_from_whom(named) -> None:
    result = graft(named("Goblin"), named("Giant Eagle"), ["speed:fly"])
    assert result.changes[0] == "Polymorph: features borrowed from Giant Eagle"
    assert "Borrowed movement: Fly 80 ft." in result.changes


def test_a_feature_the_donor_cannot_lend_or_nothing_at_all_is_refused(named) -> None:
    with pytest.raises(ValueError):
        graft(named("Goblin"), named("Giant Eagle"), ["speed:burrow"])
    with pytest.raises(ValueError):
        graft(named("Goblin"), named("Giant Eagle"), [])


def test_the_original_monsters_are_left_untouched(named) -> None:
    base, donor = named("Goblin"), named("Adult Red Dragon")
    before = (base.model_dump(), donor.model_dump())
    graft(base, donor, keys(base, donor)[:MAX_BORROW])
    assert (base.model_dump(), donor.model_dump()) == before


# --- the sweep: thousands of random pairs and random ticks ------------------------------------------------

# The Purple Worm hits at +9 where its Strength gives +14, and the validator raises any new attack to the rule's bonus, which
# alone moves the estimator two steps (see the remix sweep). Every other base must stay within one step.
LOW_BONUS_MONSTERS = {"Purple Worm"}


def as_reskin(monster: Monster) -> Monster:
    return monster.model_copy(update={"source": Source.RESKIN, "validated": False})


def findings_text(monster: Monster) -> list[str]:
    return [f.message for f in Validator().validate(monster).findings]


def test_random_pairs_with_random_ticks_stay_valid_rule_abiding_and_near_the_bases_cr(everyone) -> None:
    rng = random.Random(2024)
    checked = 0
    problems: list[str] = []
    for _ in range(2500):
        base, donor = rng.sample(everyone, 2)
        offered = borrowable(base, donor)
        if not offered:
            continue
        chosen = [b.key for b in rng.sample(offered, rng.randint(1, min(5, len(offered))))]
        legendary = base.legendary_actions is None and rng.random() < 0.4
        where = f"{base.name} <- {donor.name}: {chosen}{' + legendary' if legendary else ''}"
        try:
            monster = graft(base, donor, chosen, legendary=legendary).monster
            assert Monster.model_validate(monster.model_dump(mode="json")) == monster
        except Exception as error:  # noqa: BLE001
            problems.append(f"{where}: {error!r}"[:200])
            continue
        checked += 1
        base_findings = set(findings_text(as_reskin(base)))
        new = [m for m in findings_text(as_reskin(monster)) if m not in base_findings and "CR consistency" not in m and "Claimed CR" not in m]
        if new:
            problems.append(f"{where}: new validator complaint {new[0]}")
        drift = abs(estimate(monster).index - estimate(base).index)
        if drift > (2 if base.name in LOW_BONUS_MONSTERS else 1):
            problems.append(f"{where}: CR drift {drift}")
    assert checked > 2000, checked
    assert not problems, "\n".join(problems[:10]) + f"\n({len(problems)} problems in {checked} grafts)"


# --- legendary actions --------------------------------------------------------------------------------------


def test_legendary_actions_are_borrowed_when_the_donor_has_them_and_still_fit(named) -> None:
    result = graft(named("Goblin"), named("Adult Red Dragon"), ["attack:Tail"], legendary=True)
    legendary = result.monster.legendary_actions
    assert legendary is not None and legendary.per_round == 3
    texts = {o.name: o.text for o in legendary.options}
    assert "Tail Attack" in texts and "Detect" in texts
    assert "Wing Attack" not in texts  # it flies off, and the goblin cannot fly
    assert not any("dragon" in t.lower() for t in texts.values()) and "Legendary actions: 3 a round, borrowed from Adult Red Dragon" in result.changes
    assert "legendary" in [f.value for f in result.monster.features]


def test_legendary_actions_are_built_from_the_hybrids_own_attacks_when_neither_has_them(named) -> None:
    result = graft(named("Goblin"), named("Giant Eagle"), ["attack:Talons"], legendary=True)
    legendary = result.monster.legendary_actions
    assert legendary is not None and legendary.per_round == 3
    assert [(o.name, o.cost) for o in legendary.options] == [("Scimitar Attack", 1), ("Move", 1), ("Talons", 2)]
    assert "built from its own attacks" in result.changes[-1]


def test_a_borrowed_ability_on_a_recharge_is_not_offered_as_a_legendary_action(named) -> None:
    result = graft(named("Goblin"), named("Adult Red Dragon").model_copy(update={"legendary_actions": None}), ["attack:Fire Breath"], legendary=True)
    assert [o.name for o in result.monster.legendary_actions.options] == ["Scimitar Attack", "Move"]  # type: ignore[union-attr]


def test_a_base_with_legendary_actions_cannot_be_given_more(named) -> None:
    with pytest.raises(ValueError):
        graft(named("Adult Red Dragon"), named("Wolf"), ["sense:darkvision"] if "sense:darkvision" in keys(named("Adult Red Dragon"), named("Wolf")) else keys(named("Adult Red Dragon"), named("Wolf"))[:1], legendary=True)


def test_legendary_actions_are_off_unless_asked_for(named) -> None:
    assert graft(named("Goblin"), named("Giant Eagle"), ["speed:fly"]).monster.legendary_actions is None


def test_the_ais_names_are_used_for_the_built_legendary_actions_by_role(named) -> None:
    result = graft(named("Goblin"), named("Giant Eagle"), ["attack:Talons"], legendary=True, legendary_names=["Lightning Lunge", "Fade Away", "Rake"])
    assert [o.name for o in result.monster.legendary_actions.options] == ["Lightning Lunge", "Fade Away", "Rake"]  # type: ignore[union-attr]


def test_a_missing_repeated_or_too_long_name_falls_back_to_the_plain_one(named) -> None:
    result = graft(named("Goblin"), named("Giant Eagle"), ["attack:Talons"], legendary=True, legendary_names=["Scimitar", "x" * 41])
    names = [o.name for o in result.monster.legendary_actions.options]  # type: ignore[union-attr]
    assert names == ["Scimitar Attack", "Move", "Talons"]  # "Scimitar" is the goblin's own action; the long one and the missing one are plain


def test_the_ais_names_are_ignored_when_the_donors_own_legendary_actions_are_used(named) -> None:
    result = graft(named("Goblin"), named("Adult Red Dragon"), ["attack:Tail"], legendary=True, legendary_names=["A", "B", "C"])
    assert "Tail Attack" in [o.name for o in result.monster.legendary_actions.options]  # type: ignore[union-attr]
