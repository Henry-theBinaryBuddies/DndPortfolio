"""Turns the SRD's action entries into our hybrid actions.

The hybrid model has typed actions (attack, save, multiattack) and free-text actions. This parser tries to give an
entry a type, and keeps it as text when it cannot do that *exactly*. The safety rule is a round trip: a typed
attack or save is accepted only if ``describe()`` writes back precisely the SRD's own wording. So a typed action
never changes what the stat block says, and a text action never loses anything.
"""

import re

from pydantic import ValidationError

from cauldron.actions import (
    Action,
    Area,
    AttackAction,
    AttackDetails,
    DamageRoll,
    MultiattackAction,
    MultiattackEntry,
    Range,
    Recharge,
    SaveAction,
    SaveDetails,
    TextAction,
)
from cauldron.dice import ability_modifier
from cauldron.monster import Abilities, LegendaryOption
from cauldron.options import Ability, AreaShape, AttackMode, DamageType, SaveSuccess

_ABILITY_BY_NAME = {
    "Strength": Ability.STR,
    "Dexterity": Ability.DEX,
    "Constitution": Ability.CON,
    "Intelligence": Ability.INT,
    "Wisdom": Ability.WIS,
    "Charisma": Ability.CHA,
}
_MODE_BY_LABEL = {
    "Melee Weapon Attack": AttackMode.MELEE_WEAPON,
    "Ranged Weapon Attack": AttackMode.RANGED_WEAPON,
    "Melee Spell Attack": AttackMode.MELEE_SPELL,
    "Ranged Spell Attack": AttackMode.RANGED_SPELL,
}

_DAMAGE = re.compile(r"(\d+) \((\d+d\d+(?: [+-] \d+)?)\) ([a-z]+) damage")
_ATTACK = re.compile(
    r"(?P<label>Melee Weapon Attack|Ranged Weapon Attack|Melee Spell Attack|Ranged Spell Attack): "
    r"(?P<sign>[+-])(?P<hit>\d+) to hit, "
    r"(?:reach (?P<reach>\d+) ft\.|range (?P<normal>\d+)(?:/(?P<long>\d+))? ft\.), "
    r"(?P<targets>[^.]+)\. Hit: (?P<rest>.*)",
    re.DOTALL,
)
_SAVE = re.compile(
    r"(?:Each creature in a (?P<size>\d+)-foot(?P<shape>-radius sphere| radius| cone| cube| line(?: that is (?P<width>\d+) feet wide)?)"
    r"|The target) must make a DC (?P<dc>\d+) (?P<ability>Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw"
    r"(?:, taking (?P<damage>.+?) on a failed save(?P<half>, or half as much damage on a successful one)?)?\."
    r"(?: (?P<effects>.*))?",
    re.DOTALL,
)
_LEGENDARY_COST = re.compile(r"\s*\(Costs (\d+) Actions?\)\s*$")

_SHAPES = {"-radius sphere": AreaShape.SPHERE, " radius": AreaShape.RADIUS, " cone": AreaShape.CONE, " cube": AreaShape.CUBE}


# --- damage ---------------------------------------------------------------------------------------------


def _roll(match: re.Match[str]) -> DamageRoll:
    dice_text = match.group(2)
    dice, _, rest = dice_text.partition(" ")
    bonus = 0
    if rest:
        sign, amount = rest.split(" ")
        bonus = int(amount) * (-1 if sign == "-" else 1)
    return DamageRoll(dice=dice, bonus=bonus, type=DamageType(match.group(3)))


def _damage_chain(text: str, start: int = 0) -> tuple[list[DamageRoll], int]:
    """Reads "19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage" from `start`. Returns the rolls and the
    position just after the last one. Raises ValueError if there is no roll."""
    rolls: list[DamageRoll] = []
    position = start
    while True:
        match = _DAMAGE.match(text, position)
        if match is None:
            break
        rolls.append(_roll(match))
        position = match.end()
        if text.startswith(" plus ", position):
            position += len(" plus ")
        else:
            break
    if not rolls:
        raise ValueError("no damage roll")
    return rolls, position


# --- attacks and saves ----------------------------------------------------------------------------------


def _attack_ability(mode: AttackMode, to_hit: int, abilities: Abilities, proficiency_bonus: int) -> Ability:
    """The ability whose modifier plus proficiency best explains the attack bonus."""
    if mode in (AttackMode.MELEE_SPELL, AttackMode.RANGED_SPELL):
        candidates = [Ability.INT, Ability.WIS, Ability.CHA]
    elif mode is AttackMode.RANGED_WEAPON:
        candidates = [Ability.DEX, Ability.STR]
    else:
        candidates = [Ability.STR, Ability.DEX]
    # min() keeps the first of equals, so the order above is the tie-break.
    return min(candidates, key=lambda a: abs(to_hit - (proficiency_bonus + ability_modifier(getattr(abilities, a.value)))))


def _try_attack(desc: str, name: str, abilities: Abilities, proficiency_bonus: int) -> AttackAction | None:
    match = _ATTACK.fullmatch(desc)
    if match is None:
        return None
    to_hit = int(match["hit"]) * (-1 if match["sign"] == "-" else 1)
    mode = _MODE_BY_LABEL[match["label"]]
    rolls, end = _damage_chain(match["rest"])
    rest = match["rest"]
    if not rest.startswith(".", end):
        return None
    after = rest[end + 1 :]
    if after and not after.startswith(" "):
        return None
    reach = int(match["reach"]) if match["reach"] else None
    ranged = Range(normal=int(match["normal"]), long=int(match["long"] or match["normal"])) if match["normal"] else None
    return AttackAction(
        name=name,
        attack=AttackDetails(
            mode=mode,
            ability=_attack_ability(mode, to_hit, abilities, proficiency_bonus),
            to_hit=to_hit,
            reach=reach,
            range=ranged,
            targets=match["targets"],
        ),
        damage=rolls,
        effects_text=after[1:] or None,
    )


def _try_save(desc: str, name: str, recharge: Recharge | None) -> SaveAction | None:
    match = _SAVE.fullmatch(desc)
    if match is None:
        return None
    area = None
    if match["size"]:
        shape_text = match["shape"]
        shape = AreaShape.LINE if shape_text.startswith(" line") else _SHAPES[shape_text]
        area = Area(shape=shape, size=int(match["size"]), width=int(match["width"]) if match["width"] else None)
    on_fail: list[DamageRoll] = []
    if match["damage"]:
        on_fail, end = _damage_chain(match["damage"])
        if end != len(match["damage"]):
            return None
    return SaveAction(
        name=name,
        recharge=recharge,
        save=SaveDetails(ability=_ABILITY_BY_NAME[match["ability"]], dc=int(match["dc"])),
        area=area,
        on_fail=on_fail,
        on_success=SaveSuccess.HALF if match["half"] else SaveSuccess.NONE,
        effects_text=match["effects"] or None,
    )


# --- multiattack ----------------------------------------------------------------------------------------


def _sequence(raw: dict) -> list[MultiattackEntry]:
    """The action counts of a multiattack. When the data offers choices, the first choice is used."""
    items: list[dict] = list(raw.get("actions") or [])
    if not items and raw.get("action_options"):
        options = raw["action_options"]["from"]["options"]
        first = options[0] if options else {}
        items = list(first.get("items", [first] if "action_name" in first else []))
    return [MultiattackEntry(action=item["action_name"], count=int(item["count"])) for item in items if item.get("action_name")]


# --- the entry point ------------------------------------------------------------------------------------


def _name_with_usage(name: str, usage: dict | None) -> str:
    """Per-day and rest usage are part of the printed name: "Enslave (3/Day)"."""
    if not usage:
        return name
    if usage["type"] == "per day":
        return f"{name} ({usage['times']}/Day)"
    if usage["type"] == "recharge after rest":
        rests = " or ".join(rest.capitalize() for rest in usage.get("rest_types", ["short", "long"]))
        return f"{name} (Recharges after a {rests} Rest)"
    return name


def _recharge(usage: dict | None) -> Recharge | None:
    if usage and usage["type"] == "recharge on roll":
        return Recharge(min=int(usage["min_value"]))
    return None


def parse_action(raw: dict, monster_name: str, abilities: Abilities, proficiency_bonus: int) -> Action:
    """One action, reaction or trait entry from the data, as typed as it can exactly be."""
    desc: str = raw["desc"]
    name = _name_with_usage(raw["name"], raw.get("usage"))
    recharge = _recharge(raw.get("usage"))

    if raw["name"] == "Multiattack":
        try:
            sequence = _sequence(raw)
        except (KeyError, ValueError, TypeError):
            sequence = []
        if sequence:
            return MultiattackAction(name=name, sequence=sequence, text=desc)
        return TextAction(name=name, text=desc)

    try:
        typed: Action | None = None
        if recharge is None:  # an attack has no recharge, so a recharging attack stays text
            typed = _try_attack(desc, name, abilities, proficiency_bonus)
        if typed is None:
            typed = _try_save(desc, name, recharge)
        # The round trip: keep the typed version only if it prints exactly what the SRD prints.
        if typed is not None and typed.describe(monster_name) == desc:
            return typed
    except (ValueError, ValidationError):
        pass
    return TextAction(name=name, text=desc, recharge=recharge)


def parse_legendary_action(raw: dict) -> LegendaryOption:
    """A legendary option; its cost is written in the name: "Wing Attack (Costs 2 Actions)"."""
    match = _LEGENDARY_COST.search(raw["name"])
    cost = int(match.group(1)) if match else 1
    name = raw["name"][: match.start()] if match else raw["name"]
    return LegendaryOption(name=name, cost=cost, text=raw["desc"])
