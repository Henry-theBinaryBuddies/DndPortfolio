"""Tests for the validator and its checks.

Each rule from docs/REQUIREMENTS.md section 6 is its own Check subclass, and each is tested alone. The
Validator then runs them together over a copy of the monster.
"""

import json
from collections.abc import Callable
from pathlib import Path

import pytest

from cauldron.actions import AttackAction, SaveAction
from cauldron.blocklist import blocked_term
from cauldron.dice import ability_modifier, format_dice
from cauldron.features import derive_features
from cauldron.monster import Monster
from cauldron.options import Feature, Source
from cauldron.rules import SRD_ATTRIBUTION
from cauldron.validator import (
    AttackBonusCheck,
    AttributionCheck,
    Check,
    DerivedFieldsCheck,
    FeaturesCheck,
    HitPointsCheck,
    LegendaryCheck,
    NameCheck,
    Outcome,
    SaveDcCheck,
    SpellcastingCheck,
    Status,
    ValidationContext,
    Validator,
)

SAMPLES_PATH = Path(__file__).parents[2] / "frontend" / "public" / "data" / "sample-monsters.json"
SAMPLES = [Monster.model_validate(m) for m in json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))]
CONTEXT = ValidationContext()


def sample(name: str) -> Monster:
    return next(m for m in SAMPLES if m.name == name)


def edit(monster: Monster, change: Callable[[dict], None]) -> Monster:
    """A changed copy: dump to a plain dict, change it, and validate it again."""
    data = monster.model_dump(mode="json")
    change(data)
    return Monster.model_validate(data)


def outcomes(check: Check, monster: Monster, context: ValidationContext = CONTEXT) -> list[Outcome]:
    return [f.outcome for f in check.run(monster, context).findings]


# --- helpers that live next to the checks ---------------------------------------------------------------


def test_format_dice() -> None:
    assert format_dice(4, 8, 8) == "4d8+8"
    assert format_dice(2, 6, 0) == "2d6"
    assert format_dice(3, 4, -3) == "3d4-3"


@pytest.mark.parametrize("raw", SAMPLES, ids=lambda m: m.name)
def test_derived_features_match_every_sample(raw: Monster) -> None:
    assert derive_features(raw) == raw.features


def test_features_come_from_the_stat_block() -> None:
    drake = sample("Stormhide Drake")
    assert derive_features(drake) == [Feature.FLYING, Feature.MULTIATTACK, Feature.BREATH_WEAPON]
    assert derive_features(sample("Voidbloom Seer")) == [
        Feature.FLYING,
        Feature.MULTIATTACK,
        Feature.LEGENDARY,
        Feature.SPELLCASTING,
    ]
    # A dragon's recharging cone is a breath weapon even when its name does not say "breath"; other creatures' are not.
    assert Feature.BREATH_WEAPON in derive_features(sample("Hoarfrost Drakeling"))
    assert Feature.BREATH_WEAPON not in derive_features(sample("Gravewick Stalker"))
    assert Feature.REGENERATION in derive_features(sample("Gloamslick Ooze"))
    assert Feature.SWIMMING in derive_features(sample("Murkmaw Lurker"))


# --- the name blocklist ---------------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["Beholder", "Elder BEHOLDER", "mind-flayer scout", "The Mind  Flayer's Pet", "Strahd's Hound"])
def test_product_identity_names_are_blocked(name: str) -> None:
    assert blocked_term(name) is not None


@pytest.mark.parametrize("name", ["Cinderkite", "Beholdering Gaze", "Owlbear", "Flayer Fish Pie", "Gilded Hexer"])
def test_ordinary_names_pass_the_blocklist(name: str) -> None:
    assert blocked_term(name) is None


def test_name_check_rejects_a_blocked_name() -> None:
    monster = edit(sample("Cinderkite"), lambda d: d.update(name="Death Tyrant"))
    assert outcomes(NameCheck(), monster) == [Outcome.REJECT]


def test_name_check_rejects_a_duplicate_ignoring_case_and_spaces() -> None:
    monster = sample("Cinderkite")
    context = ValidationContext(existing_names=frozenset({"CINDERKITE"}))
    assert outcomes(NameCheck(), monster, context) == [Outcome.REJECT]
    context = ValidationContext(existing_names=frozenset({"  cinderkite "}))
    assert outcomes(NameCheck(), monster, context) == [Outcome.REJECT]


def test_name_check_passes_a_new_name() -> None:
    assert outcomes(NameCheck(), sample("Cinderkite"), ValidationContext(existing_names=frozenset({"wolf"}))) == []


# --- derived fields -------------------------------------------------------------------------------------


def test_derived_fields_correct_xp_and_proficiency_bonus() -> None:
    monster = edit(sample("Stormhide Drake"), lambda d: d["challenge"].update(xp=1, proficiency_bonus=5))
    result = DerivedFieldsCheck().run(monster, CONTEXT)
    assert [f.outcome for f in result.findings] == [Outcome.CORRECTED, Outcome.CORRECTED]
    assert result.monster.challenge.xp == 1100
    assert result.monster.challenge.proficiency_bonus == 2


def test_derived_fields_correct_cr_value_to_match_the_label() -> None:
    monster = edit(sample("Stormhide Drake"), lambda d: d["challenge"].update(cr_value=9))
    result = DerivedFieldsCheck().run(monster, CONTEXT)
    assert result.monster.challenge.cr_value == 4


def test_an_unknown_cr_label_is_rejected() -> None:
    monster = edit(sample("Stormhide Drake"), lambda d: d["challenge"].update(cr="4.5"))
    assert outcomes(DerivedFieldsCheck(), monster) == [Outcome.REJECT]


def test_good_derived_fields_pass() -> None:
    assert outcomes(DerivedFieldsCheck(), sample("Stormhide Drake")) == []


# --- hit points -----------------------------------------------------------------------------------------


def test_hit_points_use_the_die_for_the_size() -> None:
    # A Medium monster rolls d8s, whatever the generator wrote.
    monster = edit(sample("Gloomcap Shambler"), lambda d: d["hit_points"].update(dice="4d10+8", average=52))
    result = HitPointsCheck().run(monster, CONTEXT)
    assert result.findings
    assert result.monster.hit_points.dice == "4d8+8"
    assert result.monster.hit_points.average == 26


def test_hit_points_add_the_constitution_modifier_per_die() -> None:
    monster = edit(sample("Gloomcap Shambler"), lambda d: d["hit_points"].update(dice="4d8+20", average=38))
    result = HitPointsCheck().run(monster, CONTEXT)
    con = ability_modifier(monster.abilities.con)
    assert result.monster.hit_points.dice == format_dice(4, 8, 4 * con)
    assert result.monster.hit_points.average == 26


def test_hit_points_average_must_match_the_dice() -> None:
    monster = edit(sample("Gloomcap Shambler"), lambda d: d["hit_points"].update(average=99))
    result = HitPointsCheck().run(monster, CONTEXT)
    assert result.monster.hit_points.average == 26
    assert result.monster.hit_points.dice == "4d8+8"


def test_a_negative_constitution_modifier_writes_a_minus() -> None:
    monster = edit(sample("Cellar Scrabbler"), lambda d: (d["abilities"].update(con=6), d["hit_points"].update(dice="2d4", average=5)))
    result = HitPointsCheck().run(monster, CONTEXT)
    assert result.monster.hit_points.dice == "2d4-4"
    assert result.monster.hit_points.average == 1  # never below 1


def test_good_hit_points_pass() -> None:
    assert outcomes(HitPointsCheck(), sample("Dune Leviathan")) == []


# --- attack bonus and save DC ---------------------------------------------------------------------------


def first_attack(monster: Monster) -> AttackAction:
    return next(a for a in monster.actions if isinstance(a, AttackAction))


def expected_to_hit(monster: Monster) -> int:
    attack = first_attack(monster).attack
    return monster.challenge.proficiency_bonus + ability_modifier(getattr(monster.abilities, attack.ability.value))


def set_first_attack_bonus(monster: Monster, to_hit: int) -> Monster:
    def change(data: dict) -> None:
        next(a for a in data["actions"] if a["kind"] == "attack")["attack"]["to_hit"] = to_hit

    return edit(monster, change)


def test_attack_bonus_below_the_rule_is_corrected() -> None:
    base = sample("Stormhide Drake")
    monster = set_first_attack_bonus(base, expected_to_hit(base) - 4)
    result = AttackBonusCheck().run(monster, CONTEXT)
    assert [f.outcome for f in result.findings] == [Outcome.CORRECTED]
    assert first_attack(result.monster).attack.to_hit == expected_to_hit(base)


def test_a_small_magic_bonus_above_the_rule_is_allowed() -> None:
    # +1 to +3 above is what magic weapons and the elite template add.
    base = sample("Stormhide Drake")
    for extra in (0, 1, 3):
        assert outcomes(AttackBonusCheck(), set_first_attack_bonus(base, expected_to_hit(base) + extra)) == []


def test_a_bonus_far_above_the_rule_is_corrected() -> None:
    base = sample("Stormhide Drake")
    monster = set_first_attack_bonus(base, expected_to_hit(base) + 9)
    result = AttackBonusCheck().run(monster, CONTEXT)
    assert first_attack(result.monster).attack.to_hit == expected_to_hit(base)


def breath(monster: Monster) -> SaveAction:
    return next(a for a in monster.actions if isinstance(a, SaveAction))


def set_save_dc(monster: Monster, dc: int) -> Monster:
    def change(data: dict) -> None:
        next(a for a in data["actions"] if a["kind"] == "save")["save"]["dc"] = dc

    return edit(monster, change)


def test_a_save_dc_no_ability_can_reach_is_corrected_to_the_nearest_one() -> None:
    base = sample("Stormhide Drake")
    result = SaveDcCheck().run(set_save_dc(base, 28), CONTEXT)
    assert [f.outcome for f in result.findings] == [Outcome.CORRECTED]
    pb = base.challenge.proficiency_bonus
    reachable = {8 + pb + ability_modifier(getattr(base.abilities, a)) for a in ("str", "dex", "con", "int", "wis", "cha")}
    assert breath(result.monster).save.dc == max(reachable)


def test_a_reachable_save_dc_passes() -> None:
    assert outcomes(SaveDcCheck(), sample("Stormhide Drake")) == []


# --- spellcasting ---------------------------------------------------------------------------------------


def test_spellcasting_numbers_are_corrected_and_the_intro_follows() -> None:
    base = sample("Hollowvale Hexer")  # Cha 12-ish, proficiency +2
    monster = edit(base, lambda d: d["spellcasting"].update(dc=20, attack_bonus=12))
    result = SpellcastingCheck().run(monster, CONTEXT)
    sc = result.monster.spellcasting
    assert sc is not None
    pb = base.challenge.proficiency_bonus
    mod = ability_modifier(base.abilities.cha)
    assert sc.dc == 8 + pb + mod
    assert sc.attack_bonus == pb + mod
    assert f"spell save DC {sc.dc}" in sc.intro
    assert f"+{sc.attack_bonus} to hit with spell attacks" in sc.intro


def test_a_small_boost_to_spell_numbers_is_allowed() -> None:
    base = sample("Hollowvale Hexer")
    assert base.spellcasting is not None
    monster = edit(base, lambda d: d["spellcasting"].update(dc=base.spellcasting.dc + 1, attack_bonus=base.spellcasting.attack_bonus + 1))
    assert outcomes(SpellcastingCheck(), monster) == []


def test_spellcasting_check_ignores_monsters_without_spells() -> None:
    assert outcomes(SpellcastingCheck(), sample("Cinderkite")) == []


# --- legendary actions ----------------------------------------------------------------------------------


def test_too_many_legendary_actions_per_round_is_corrected_to_three() -> None:
    monster = edit(sample("Voidbloom Seer"), lambda d: d["legendary_actions"].update(per_round=5))
    result = LegendaryCheck().run(monster, CONTEXT)
    assert result.monster.legendary_actions is not None
    assert result.monster.legendary_actions.per_round == 3


def test_a_legendary_option_cannot_cost_more_than_the_pool() -> None:
    def change(d: dict) -> None:
        d["legendary_actions"]["per_round"] = 2
        d["legendary_actions"]["options"][0]["cost"] = 3

    result = LegendaryCheck().run(edit(sample("Voidbloom Seer"), change), CONTEXT)
    assert result.monster.legendary_actions is not None
    assert all(o.cost <= 2 for o in result.monster.legendary_actions.options)


def test_good_legendary_actions_pass() -> None:
    assert outcomes(LegendaryCheck(), sample("Voidbloom Seer")) == []


# --- features -------------------------------------------------------------------------------------------


def test_features_are_replaced_by_what_the_stat_block_really_has() -> None:
    monster = edit(sample("Cinderkite"), lambda d: d.update(features=["swimming", "legendary"]))
    result = FeaturesCheck().run(monster, CONTEXT)
    assert result.monster.features == [Feature.FLYING]
    assert [f.outcome for f in result.findings] == [Outcome.CORRECTED]


def test_matching_features_pass() -> None:
    assert outcomes(FeaturesCheck(), sample("Cinderkite")) == []


# --- attribution ----------------------------------------------------------------------------------------


def as_srd(monster: Monster, attribution: str | None) -> Monster:
    return edit(monster, lambda d: d.update(source="srd", attribution=attribution))


def test_an_srd_monster_needs_the_exact_attribution() -> None:
    base = sample("Cinderkite")
    assert outcomes(AttributionCheck(), as_srd(base, None)) == [Outcome.REJECT]
    assert outcomes(AttributionCheck(), as_srd(base, "Some SRD monster")) == [Outcome.REJECT]
    assert outcomes(AttributionCheck(), as_srd(base, SRD_ATTRIBUTION)) == []


def test_a_misquoted_srd_claim_is_rejected_on_any_source() -> None:
    monster = edit(sample("Cinderkite"), lambda d: d.update(attribution="Based on the System Reference Document, roughly."))
    assert outcomes(AttributionCheck(), monster) == [Outcome.REJECT]


def test_other_sources_need_no_attribution() -> None:
    assert outcomes(AttributionCheck(), sample("Cinderkite")) == []


# --- the validator --------------------------------------------------------------------------------------


# Hand-written samples whose numbers the CR estimator disagrees with. The Dune Leviathan has 350 hit points, which is
# typical of a CR 17 or higher monster, but is rated CR 12. Left as written; the check is doing what it should.
FLAGGED_BY_ESTIMATOR = {"Dune Leviathan"}


@pytest.mark.parametrize("monster", [m for m in SAMPLES if m.name not in FLAGGED_BY_ESTIMATOR], ids=lambda m: m.name)
def test_every_sample_is_accepted_without_changes(monster: Monster) -> None:
    report = Validator().validate(monster)
    assert report.findings == []
    assert report.status is Status.ACCEPTED
    assert report.monster.validated is True


def test_a_sample_the_estimator_disagrees_with_is_sent_back_for_a_retry() -> None:
    report = Validator().validate(sample("Dune Leviathan"))
    assert report.status is Status.RETRY
    assert report.monster.validated is False
    assert [f.check for f in report.retries] == ["CR consistency"]
    assert "Claimed CR 12" in report.retries[0].message


# --- the CR consistency check ---------------------------------------------------------------------------


def with_cr(monster: Monster, cr: str) -> Monster:
    from cauldron.rules import cr_value, proficiency_bonus, xp_for_cr

    challenge = monster.challenge.model_copy(
        update={"cr": cr, "cr_value": cr_value(cr), "xp": xp_for_cr(cr), "proficiency_bonus": proficiency_bonus(cr)}
    )
    return monster.model_copy(update={"challenge": challenge})


def test_a_claim_far_below_the_numbers_asks_for_a_retry() -> None:
    from cauldron.validator import CrConsistencyCheck

    monster = with_cr(sample("Stormhide Drake"), "0")
    assert outcomes(CrConsistencyCheck(), monster) == [Outcome.RETRY]


def test_a_claim_that_fits_passes_the_cr_check() -> None:
    from cauldron.validator import CrConsistencyCheck

    assert outcomes(CrConsistencyCheck(), sample("Stormhide Drake")) == []


def test_high_challenge_ratings_are_noted_not_judged() -> None:
    from cauldron.validator import CrConsistencyCheck

    monster = with_cr(sample("Stormhide Drake"), "26")
    assert outcomes(CrConsistencyCheck(), monster) == [Outcome.NOTED]


def test_srd_monsters_are_never_sent_back_for_a_retry() -> None:
    claimed_wrong = with_cr(sample("Stormhide Drake"), "0").model_copy(update={"source": Source.SRD, "attribution": SRD_ATTRIBUTION})
    report = Validator().validate(claimed_wrong)
    assert report.status is Status.ACCEPTED
    assert any(f.check == "CR consistency" and f.outcome is Outcome.NOTED for f in report.findings)


def test_a_rejection_outranks_a_retry() -> None:
    monster = edit(with_cr(sample("Stormhide Drake"), "0"), lambda d: d.update(name="Beholder"))
    assert Validator().validate(monster).status is Status.REJECTED


def test_a_monster_with_fixable_mistakes_comes_back_corrected() -> None:
    monster = edit(sample("Stormhide Drake"), lambda d: d["challenge"].update(xp=1))
    report = Validator().validate(monster)
    assert report.status is Status.CORRECTED
    assert report.monster.challenge.xp == 1100
    assert report.monster.validated is True
    assert any(f.outcome is Outcome.CORRECTED for f in report.findings)


def test_a_rejected_monster_is_not_marked_validated() -> None:
    monster = edit(sample("Cinderkite"), lambda d: d.update(name="Beholder"))
    report = Validator().validate(monster)
    assert report.status is Status.REJECTED
    assert report.monster.validated is False
    assert report.errors


def test_the_original_monster_is_never_changed() -> None:
    monster = edit(sample("Stormhide Drake"), lambda d: d["challenge"].update(xp=1))
    before = monster.model_dump()
    Validator().validate(monster)
    assert monster.model_dump() == before


def test_srd_monsters_keep_their_printed_numbers_and_get_notes_instead() -> None:
    # Official statistics are not "corrected"; the difference is only noted.
    base = sample("Stormhide Drake")
    monster = edit(base, lambda d: d.update(source="srd", attribution=SRD_ATTRIBUTION, features=["swimming"]))
    report = Validator().validate(monster)
    assert report.status is Status.ACCEPTED
    assert report.monster.features == monster.features
    assert report.notes
    assert not report.errors


def test_all_problems_are_reported_together() -> None:
    def change(d: dict) -> None:
        d["name"] = "Mind Flayer"
        d["challenge"]["xp"] = 1

    report = Validator().validate(edit(sample("Stormhide Drake"), change))
    assert {f.check for f in report.findings} >= {"name", "derived fields"}


def test_a_custom_list_of_checks_can_be_used() -> None:
    report = Validator(checks=[NameCheck()]).validate(edit(sample("Cinderkite"), lambda d: d["challenge"].update(xp=1)))
    assert report.status is Status.ACCEPTED  # the XP check was not in the list


def test_duplicate_names_are_found_through_the_context() -> None:
    report = Validator().validate(sample("Cinderkite"), ValidationContext(existing_names=frozenset({"cinderkite"})))
    assert report.status is Status.REJECTED


def test_sources_are_enum_values() -> None:
    assert sample("Cinderkite").source is Source.CURATED
