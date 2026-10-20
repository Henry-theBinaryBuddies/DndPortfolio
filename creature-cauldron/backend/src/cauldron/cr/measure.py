"""Measures a monster for the CR estimator: how tough it is, and how hard it hits.

Four numbers:

* effective hit points: the average, raised by half when it resists or is immune to nonmagical weapons
* armor class
* damage per round: its best round, counting multiattack, and counting damage written inside text actions
* offensive bonus: its best attack bonus, or its best save DC minus 8 (the same scale as an attack bonus)

Spells are not counted: how much a spellcaster really deals depends on which spells it casts. That is one reason the
estimator is only a sanity check.
"""

import re
from dataclasses import dataclass

from cauldron.actions import Action, AttackAction, MultiattackAction, SaveAction, TextAction
from cauldron.dice import average_dice
from cauldron.monster import Monster

_DAMAGE = re.compile(r"(\d+) \(\d+d\d+(?: [+-] \d+)?\) [a-z]+ damage")
_HIT = re.compile(r"\+(\d+) to hit")
_DC = re.compile(r"DC (\d+)")
_SENTENCE_END = re.compile(r"\.(?: |$)")
NONMAGICAL_BONUS = 1.5


@dataclass(frozen=True)
class Measures:
    effective_hp: float
    ac: int
    dpr: float
    offense_bonus: int | None  # None when the monster has no attack roll and no save DC


def _first_sentence_with_damage(text: str) -> str:
    """The first sentence that contains a damage amount. Riders such as "6 (1d12) acid damage every 10 minutes"
    come later and are not part of a round's damage."""
    start = 0
    for end in [m.end() for m in _SENTENCE_END.finditer(text)] + [len(text)]:
        sentence = text[start:end]
        if _DAMAGE.search(sentence):
            return sentence
        start = end
    return ""


def _text_damage(text: str) -> float:
    if text.startswith(("Melee", "Ranged")) and "Hit:" in text:
        # Only the Hit sentence counts, not riders such as a poison saving throw that follows.
        sentence = _first_sentence_with_damage(text.split("Hit:", 1)[1])
    else:
        sentence = _first_sentence_with_damage(text)
    return float(sum(int(amount) for amount in _DAMAGE.findall(sentence)))


def action_damage(action: Action) -> float:
    """The average damage of one use of an action, as far as it can be read."""
    if isinstance(action, AttackAction):
        return float(sum(average_dice(r.dice, r.bonus) for r in action.damage))
    if isinstance(action, SaveAction):
        return float(sum(average_dice(r.dice, r.bonus) for r in action.on_fail))
    if isinstance(action, TextAction):
        return _text_damage(action.text)
    return 0.0  # a multiattack deals no damage itself; its parts do


def _damage_per_round(monster: Monster) -> float:
    by_name = {a.name.lower(): action_damage(a) for a in monster.actions if not isinstance(a, MultiattackAction)}
    best_single = max(by_name.values(), default=0.0)
    best_round = best_single
    for action in monster.actions:
        if isinstance(action, MultiattackAction):
            total = sum(by_name.get(entry.action.lower(), best_single) * entry.count for entry in action.sequence)
            best_round = max(best_round, total)
    return best_round


def _offense_bonus(monster: Monster) -> int | None:
    found: list[int] = []
    for action in monster.actions:
        if isinstance(action, AttackAction):
            found.append(action.attack.to_hit)
        elif isinstance(action, SaveAction):
            found.append(action.save.dc - 8)
        elif isinstance(action, TextAction):
            found += [int(n) for n in _HIT.findall(action.text)]
            found += [int(n) - 8 for n in _DC.findall(action.text)]
    return max(found) if found else None


def measure(monster: Monster) -> Measures:
    hp = float(monster.hit_points.average)
    text = monster.damage_text
    if text is not None and "nonmagical" in f"{text.resistances or ''} {text.immunities or ''}":
        hp *= NONMAGICAL_BONUS
    return Measures(
        effective_hp=hp,
        ac=monster.armor_class.value,
        dpr=_damage_per_round(monster),
        offense_bonus=_offense_bonus(monster),
    )
