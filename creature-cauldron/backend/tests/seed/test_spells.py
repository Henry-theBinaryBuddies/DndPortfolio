"""Reading the SRD's spellcasting traits into structured spellcasting data."""

import re

from cauldron.monster import Abilities, Spellcasting
from cauldron.options import Ability
from cauldron.seed.spells import parse_spellcasting, spell_ref, split_spell_list

ABILITIES = Abilities(str=10, dex=14, con=12, int=17, wis=12, cha=11)


def entry(raw_monster: dict, name: str = "Spellcasting") -> dict:
    return next(a for a in raw_monster["special_abilities"] if a["name"] == name)


def abilities_of(m: dict) -> Abilities:
    return Abilities(str=m["strength"], dex=m["dexterity"], con=m["constitution"], int=m["intelligence"], wis=m["wisdom"], cha=m["charisma"])


def normalised(desc: str) -> str:
    """The SRD text with its bullet lines turned into the sentences Spellcasting.to_text() writes."""
    intro, *bullets = [line.strip() for line in desc.split("\n") if line.strip()]
    lines = [re.sub(r"^-\s*", "", b) for b in bullets]
    return " ".join([intro] + [line if line.endswith(".") else line + "." for line in lines])


def test_split_spell_list_ignores_commas_inside_brackets() -> None:
    assert split_spell_list("a, b (c, d), e") == ["a", "b (c, d)", "e"]
    assert split_spell_list("") == []


def test_spell_ref_splits_a_trailing_note() -> None:
    ref = spell_ref("levitate (self only)")
    assert (ref.name, ref.note) == ("levitate", "self only")
    assert spell_ref("fireball").note is None


def test_the_mage_has_cantrips_and_five_slot_levels(raw) -> None:
    mage = raw("mage")
    sc = parse_spellcasting(entry(mage), abilities_of(mage), mage["proficiency_bonus"])
    assert isinstance(sc, Spellcasting)
    assert sc.ability is Ability.INT and sc.dc == 14 and sc.attack_bonus == 6 and not sc.innate
    assert [s.name for s in sc.cantrips] == ["fire bolt", "light", "mage hand", "prestidigitation"]
    assert [(s.level, s.slots) for s in sc.slots] == [(1, 4), (2, 3), (3, 3), (4, 3), (5, 1)]
    assert sc.caster_level == 9
    assert sc.to_text() == normalised(entry(mage)["desc"])


def test_the_djinni_is_innate_with_at_will_and_per_day_lists(raw) -> None:
    djinni = raw("djinni")
    sc = parse_spellcasting(entry(djinni, "Innate Spellcasting"), abilities_of(djinni), djinni["proficiency_bonus"])
    assert sc is not None and sc.innate
    assert [s.name for s in sc.at_will] == ["detect evil and good", "detect magic", "thunderwave"]
    assert [(d.uses, d.each) for d in sc.per_day] == [(3, True), (1, True)]
    assert sc.per_day[0].spells[0].note == "can create wine instead of water"
    assert sc.to_text() == normalised(entry(djinni, "Innate Spellcasting")["desc"])


def test_missing_numbers_are_worked_out_from_the_ability() -> None:
    raw_entry = {
        "name": "Innate Spellcasting",
        "desc": "The sprite's innate spellcasting ability is Charisma. It can innately cast the following spells:\n\n- At will: light",
        "spellcasting": {"ability": {"index": "cha"}, "components_required": ["V"]},
    }
    sc = parse_spellcasting(raw_entry, ABILITIES, 2)
    assert sc is not None
    assert sc.dc == 8 + 2 + 0 and sc.attack_bonus == 2 + 0  # Charisma 11 has modifier +0


def test_text_without_spell_lists_is_not_structured() -> None:
    raw_entry = {
        "name": "Spellcasting",
        "desc": "The wizard knows some spells and casts them well.",
        "spellcasting": {"ability": {"index": "int"}, "dc": 12, "modifier": 4},
    }
    assert parse_spellcasting(raw_entry, ABILITIES, 2) is None


def test_the_srd_spellcasters_that_cannot_be_structured_are_the_known_five(raw_monsters) -> None:
    parsed = 0
    left_as_text: set[str] = set()
    for monster in raw_monsters:
        for ability in monster.get("special_abilities", []):
            if not ability.get("spellcasting"):
                continue
            if parse_spellcasting(ability, abilities_of(monster), monster["proficiency_bonus"]) is None:
                left_as_text.add(monster["name"])
            else:
                parsed += 1
    assert parsed >= 30
    assert left_as_text == {"Dust Mephit", "Ice Mephit", "Lamia", "Magma Mephit", "Steam Mephit"}
