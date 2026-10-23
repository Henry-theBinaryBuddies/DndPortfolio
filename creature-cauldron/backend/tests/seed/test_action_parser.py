"""Turning the SRD's action text into our hybrid actions.

The rule that protects the data: a typed action is only kept if writing it back out gives exactly the SRD's own
words. Anything that does not round-trip stays a TextAction with the original text, so nothing is lost or garbled.
"""

from cauldron.actions import AttackAction, MultiattackAction, TextAction
from cauldron.monster import Abilities
from cauldron.options import Ability, AttackMode, DamageType
from cauldron.seed.action_parser import parse_action, parse_legendary_action

ABILITIES = Abilities(str=21, dex=9, con=15, int=18, wis=15, cha=18)


def parse(raw: dict, name: str = "Aboleth", pb: int = 4):
    return parse_action(raw, monster_name=name, abilities=ABILITIES, proficiency_bonus=pb)


# --- attacks --------------------------------------------------------------------------------------------


def test_a_melee_attack_with_extra_effects_is_typed() -> None:
    desc = "Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 12 (2d6 + 5) bludgeoning damage. If the target is a creature, it must succeed on a DC 14 Constitution saving throw or become diseased."
    action = parse({"name": "Tentacle", "desc": desc, "attack_bonus": 9})
    assert isinstance(action, AttackAction)
    assert action.attack.mode is AttackMode.MELEE_WEAPON
    assert action.attack.to_hit == 9
    assert action.attack.reach == 10
    assert action.damage[0].dice == "2d6" and action.damage[0].bonus == 5
    assert action.damage[0].type is DamageType.BLUDGEONING
    assert action.effects_text == "If the target is a creature, it must succeed on a DC 14 Constitution saving throw or become diseased."
    assert action.describe("Aboleth") == desc


def test_two_damage_rolls_joined_by_plus() -> None:
    desc = "Melee Weapon Attack: +14 to hit, reach 10 ft., one target. Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage."
    action = parse({"name": "Bite", "desc": desc, "attack_bonus": 14})
    assert isinstance(action, AttackAction)
    assert [(r.dice, r.bonus, r.type) for r in action.damage] == [("2d10", 8, DamageType.PIERCING), ("2d6", 0, DamageType.FIRE)]
    assert action.describe("Dragon") == desc


def test_a_ranged_attack_with_two_ranges() -> None:
    desc = "Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage."
    action = parse({"name": "Shortbow", "desc": desc, "attack_bonus": 4}, name="Bandit", pb=2)
    assert isinstance(action, AttackAction)
    assert action.attack.mode is AttackMode.RANGED_WEAPON
    assert (action.attack.range.normal, action.attack.range.long) == (80, 320)  # type: ignore[union-attr]
    assert action.describe("Bandit") == desc


def test_a_negative_dice_bonus_is_read() -> None:
    desc = "Melee Weapon Attack: +1 to hit, reach 5 ft., one target. Hit: 1 (1d4 - 1) piercing damage."
    action = parse({"name": "Bite", "desc": desc, "attack_bonus": 1}, name="Rat", pb=2)
    assert isinstance(action, AttackAction)
    assert action.damage[0].bonus == -1
    assert action.describe("Rat") == desc


def test_spell_attacks_use_the_spell_modes() -> None:
    desc = "Ranged Spell Attack: +6 to hit, range 120 ft., one target. Hit: 11 (2d10) fire damage."
    action = parse({"name": "Fire Bolt", "desc": desc, "attack_bonus": 6})
    assert isinstance(action, AttackAction)
    assert action.attack.mode is AttackMode.RANGED_SPELL
    assert action.describe("Mage") == desc


def test_the_attack_ability_is_the_one_that_explains_the_bonus() -> None:
    # +9 = proficiency 4 + Strength 21 (+5)
    desc = "Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 12 (2d6 + 5) bludgeoning damage."
    action = parse({"name": "Tentacle", "desc": desc, "attack_bonus": 9})
    assert isinstance(action, AttackAction) and action.attack.ability is Ability.STR


def test_melee_or_ranged_attacks_stay_text_because_we_cannot_print_that_label() -> None:
    desc = "Melee or Ranged Weapon Attack: +5 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 4 (1d4 + 2) piercing damage."
    action = parse({"name": "Dagger", "desc": desc, "attack_bonus": 5})
    assert isinstance(action, TextAction)
    assert action.text == desc


def test_an_attack_whose_numbers_do_not_add_up_stays_text() -> None:
    # The SRD says 12 but 2d6 + 5 averages 12; here the printed average is wrong on purpose.
    desc = "Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 99 (2d6 + 5) bludgeoning damage."
    assert isinstance(parse({"name": "Tentacle", "desc": desc, "attack_bonus": 9}), TextAction)


def test_alternative_damage_text_stays_text() -> None:
    desc = "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage, or 6 (1d8 + 2) slashing damage if used with two hands."
    assert isinstance(parse({"name": "Longsword", "desc": desc, "attack_bonus": 4}, pb=2), TextAction)


# --- saves ----------------------------------------------------------------------------------------------


def test_a_save_with_a_lead_in_sentence_stays_text() -> None:
    desc = "The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one."
    action = parse({"name": "Fire Breath", "desc": desc, "usage": {"type": "recharge on roll", "dice": "1d6", "min_value": 5}})
    assert isinstance(action, TextAction)
    assert action.text == desc
    assert action.recharge is not None and action.recharge.min == 5


# --- usage in the name ----------------------------------------------------------------------------------


def test_per_day_and_rest_usage_are_written_into_the_name() -> None:
    per_day = parse({"name": "Enslave", "desc": "The aboleth targets one creature.", "usage": {"type": "per day", "times": 3}})
    assert per_day.name == "Enslave (3/Day)"
    rest = parse({"name": "Teleport", "desc": "It vanishes.", "usage": {"type": "recharge after rest", "rest_types": ["short", "long"]}})
    assert rest.name == "Teleport (Recharges after a Short or Long Rest)"


# --- multiattack ----------------------------------------------------------------------------------------


def test_multiattack_keeps_the_official_wording_and_the_counts() -> None:
    raw = {
        "name": "Multiattack",
        "desc": "The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.",
        "multiattack_type": "actions",
        "actions": [
            {"action_name": "Frightful Presence", "count": "1", "type": "ability"},
            {"action_name": "Bite", "count": "1", "type": "melee"},
            {"action_name": "Claw", "count": "2", "type": "melee"},
        ],
    }
    action = parse(raw, name="Adult Red Dragon")
    assert isinstance(action, MultiattackAction)
    assert action.text == raw["desc"]
    assert [(e.action, e.count) for e in action.sequence] == [("Frightful Presence", 1), ("Bite", 1), ("Claw", 2)]
    assert action.describe("Adult Red Dragon") == raw["desc"]


def test_multiattack_with_choices_uses_the_first_option_and_the_official_text() -> None:
    raw = {
        "name": "Multiattack",
        "desc": "The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers.",
        "multiattack_type": "action_options",
        "action_options": {
            "choose": 1,
            "type": "action",
            "from": {
                "option_set_type": "options_array",
                "options": [
                    {
                        "option_type": "multiple",
                        "items": [
                            {"option_type": "action", "action_name": "Scimitar", "count": "2", "type": "melee"},
                            {"option_type": "action", "action_name": "Dagger", "count": "1", "type": "melee"},
                        ],
                    },
                    {"option_type": "action", "action_name": "Dagger", "count": "2", "type": "ranged"},
                ],
            },
        },
    }
    action = parse(raw, name="Bandit Captain")
    assert isinstance(action, MultiattackAction)
    assert action.text == raw["desc"]
    assert [(e.action, e.count) for e in action.sequence] == [("Scimitar", 2), ("Dagger", 1)]


def test_a_multiattack_with_nothing_structured_stays_text() -> None:
    action = parse({"name": "Multiattack", "desc": "The creature attacks.", "multiattack_type": "actions", "actions": []})
    assert isinstance(action, TextAction)


# --- legendary actions ----------------------------------------------------------------------------------


def test_legendary_costs_are_read_from_the_name() -> None:
    option = parse_legendary_action({"name": "Wing Attack (Costs 2 Actions)", "desc": "The dragon beats its wings."})
    assert (option.name, option.cost) == ("Wing Attack", 2)
    assert parse_legendary_action({"name": "Detect", "desc": "The dragon makes a Wisdom (Perception) check."}).cost == 1


# --- the whole data set ---------------------------------------------------------------------------------


def test_most_srd_attacks_are_typed(raw_monsters) -> None:  # (a typed action always reproduces its text: the parser checks)
    typed = text = 0
    for monster in raw_monsters:
        abilities = Abilities(
            str=monster["strength"], dex=monster["dexterity"], con=monster["constitution"],
            int=monster["intelligence"], wis=monster["wisdom"], cha=monster["charisma"],
        )
        for entry in monster.get("actions", []) + monster.get("reactions", []):
            action = parse_action(entry, monster_name=monster["name"], abilities=abilities, proficiency_bonus=monster["proficiency_bonus"])
            if isinstance(action, TextAction):
                text += 1
                continue
            typed += 1
    # Most attacks should be typed; this guards against the parser quietly giving up on everything.
    assert typed > 500, (typed, text)


