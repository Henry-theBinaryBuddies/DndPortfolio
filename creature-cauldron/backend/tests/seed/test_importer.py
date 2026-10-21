"""The importer: raw SRD entries to validated Monsters, and the whole data set end to end."""

import pytest

from cauldron.actions import AttackAction, MultiattackAction, TextAction
from cauldron.monster import Monster
from cauldron.options import Ability, CreatureType, DamageType, Feature, Role, Size, Source
from cauldron.rules import SRD_ATTRIBUTION
from cauldron.seed.importer import import_all, import_monster


def imported(raw, index: str) -> Monster:
    return import_monster(raw(index)).monster


# --- one monster ----------------------------------------------------------------------------------------


def test_the_aboleth_fields(raw) -> None:
    m = imported(raw, "aboleth")
    assert (m.id, m.name, m.size, m.type) == ("srd-aboleth", "Aboleth", Size.LARGE, CreatureType.ABERRATION)
    assert m.source is Source.SRD and m.attribution == SRD_ATTRIBUTION
    assert (m.armor_class.value, m.armor_class.note) == (17, "natural armor")
    assert (m.hit_points.average, m.hit_points.dice) == (135, "18d10+36")
    assert (m.speeds.walk, m.speeds.swim, m.speeds.fly) == (10, 40, None)
    assert m.abilities.str == 21 and m.abilities.int == 18
    assert m.saves == {Ability.CON: 6, Ability.INT: 8, Ability.WIS: 6}
    assert m.skills == {"History": 12, "Perception": 10}
    assert m.senses.darkvision == 120 and m.senses.passive_perception == 20
    assert m.languages == "Deep Speech, telepathy 120 ft."
    assert (m.challenge.cr, m.challenge.xp, m.challenge.proficiency_bonus) == ("10", 5900, 4)
    assert [t.name for t in m.traits] == ["Amphibious", "Mucous Cloud", "Probing Telepathy"]
    assert isinstance(m.actions[0], MultiattackAction)
    assert any(isinstance(a, AttackAction) and a.name == "Tentacle" for a in m.actions)
    assert m.legendary_actions is not None and m.legendary_actions.per_round == 3


def test_experience_points_come_from_the_srd_table_not_the_community_file(raw) -> None:
    result = import_monster(raw("dretch"))
    assert result.monster.challenge.xp == 50
    assert any("experience points" in note.lower() for note in result.notes)


def test_cr_zero_creatures_with_no_attacks_keep_their_zero_experience_points(raw) -> None:
    assert imported(raw, "frog").challenge.xp == 0
    assert imported(raw, "rat").challenge.xp == 10


def test_a_known_hit_point_error_is_corrected(raw) -> None:
    m = imported(raw, "cult-fanatic")
    assert (m.hit_points.average, m.hit_points.dice) == (33, "6d8+6")


def test_swarms_keep_their_swarm_wording_as_a_subtype(raw) -> None:
    m = imported(raw, "swarm-of-bats")
    assert m.type is CreatureType.BEAST
    assert m.subtypes == ["swarm of Tiny beasts"]


def test_qualified_damage_lines_keep_their_exact_text(raw) -> None:
    m = imported(raw, "werewolf-hybrid")
    assert m.damage_text is not None and m.damage_text.immunities is not None
    assert "nonmagical" in m.damage_text.immunities or "nonmagical" in (m.damage_text.resistances or "")
    assert DamageType.SLASHING in (m.immunities + m.resistances)


def test_legendary_resistance_keeps_its_uses_in_the_name(raw) -> None:
    m = imported(raw, "adult-red-dragon")
    assert "Legendary Resistance (3/Day)" in [t.name for t in m.traits]


def test_legendary_options_lose_the_cost_text_but_keep_the_cost(raw) -> None:
    m = imported(raw, "adult-red-dragon")
    assert m.legendary_actions is not None
    wing = next(o for o in m.legendary_actions.options if o.name == "Wing Attack")
    assert wing.cost == 2


def test_spellcasting_is_structured_and_not_left_in_the_traits(raw) -> None:
    m = imported(raw, "mage")
    assert m.spellcasting is not None and [s.slots for s in m.spellcasting.slots] == [4, 3, 3, 3, 1]
    assert "Spellcasting" not in [t.name for t in m.traits]
    assert Feature.SPELLCASTING in m.features


def test_a_breath_weapon_is_found_for_a_dragon(raw) -> None:
    assert Feature.BREATH_WEAPON in imported(raw, "adult-red-dragon").features


def test_extra_armor_class_options_go_in_the_note(raw) -> None:
    archmage = imported(raw, "archmage")
    assert archmage.armor_class.value == 12
    assert archmage.armor_class.note is not None and "mage armor" in archmage.armor_class.note


def test_hover_is_kept(raw) -> None:
    assert imported(raw, "ghost").speeds.hover is True


def test_a_monster_with_no_actions_still_imports(raw) -> None:
    assert imported(raw, "frog").actions == []


# --- the whole data set ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def everything(raw_monsters):
    return import_all(raw_monsters)


def test_the_half_red_dragon_veteran_is_excluded(everything) -> None:
    assert "half-red-dragon-veteran" in everything.excluded
    assert all(m.id != "srd-half-red-dragon-veteran" for m in everything.monsters)


def test_everything_else_is_imported_and_nothing_is_rejected(everything, raw_monsters) -> None:
    assert len(everything.monsters) == len(raw_monsters) - len(everything.excluded) == 333
    assert everything.rejected == []


def test_ids_and_names_are_unique(everything) -> None:
    assert len({m.id for m in everything.monsters}) == len(everything.monsters)
    assert len({m.name.lower() for m in everything.monsters}) == len(everything.monsters)


def test_every_monster_carries_the_exact_attribution_and_is_validated(everything) -> None:
    for m in everything.monsters:
        assert m.source is Source.SRD and m.attribution == SRD_ATTRIBUTION and m.validated, m.name


def test_every_monster_survives_a_round_trip_through_json(everything) -> None:
    for m in everything.monsters:
        assert Monster.model_validate(m.model_dump(mode="json")) == m, m.name


def test_most_attacks_are_typed_and_the_rest_keep_their_words(everything) -> None:
    attacks = sum(isinstance(a, AttackAction) for m in everything.monsters for a in m.all_actions())
    texts = sum(isinstance(a, TextAction) for m in everything.monsters for a in m.all_actions())
    # The SRD words its saving throws in ways our typed save cannot reproduce exactly, so they stay text.
    assert attacks > 400 and texts > 200


def test_the_qualified_damage_lines_are_all_kept(everything) -> None:
    assert sum(m.damage_text is not None for m in everything.monsters) >= 65


def test_every_monster_has_tags(everything) -> None:
    for m in everything.monsters:
        assert 1 <= len(m.environments) <= 3 and m.role in set(Role), m.name


def test_the_srd_monsters_have_the_real_hit_points_from_the_official_document(everything) -> None:
    by_name = {m.name: m for m in everything.monsters}
    assert by_name["Tarrasque"].hit_points.average == 676
    assert by_name["Lich"].challenge.cr == "21"
    assert by_name["Goblin"].hit_points.dice == "2d6"


def test_the_validator_never_changes_srd_numbers(everything, raw_monsters) -> None:
    raw_by_index = {m["index"]: m for m in raw_monsters}
    for m in everything.monsters:
        raw_monster = raw_by_index[m.id.removeprefix("srd-")]
        if raw_monster["index"] != "cult-fanatic":
            assert m.hit_points.average == raw_monster["hit_points"], m.name
        assert m.armor_class.value == raw_monster["armor_class"][0]["value"], m.name


def test_a_report_can_be_written(everything) -> None:
    from cauldron.seed.report import write_report

    report = write_report(everything)
    assert "333" in report and "Half-Red Dragon Veteran".lower().replace(" ", "-") in report
    assert "Validator notes" in report
