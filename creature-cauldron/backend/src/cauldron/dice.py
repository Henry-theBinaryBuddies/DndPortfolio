"""Dice and ability arithmetic, mirroring frontend/src/lib/dice.ts.

Plain functions, no classes needed: each takes values in and gives a value back, so they are easy to test.
"""

import re
from dataclasses import dataclass

# [0-9] rather than \d, because \d also matches digits from other alphabets.
_DICE = re.compile(r"([0-9]+)d([0-9]+)(?:\s*([+-])\s*([0-9]+))?")


@dataclass(frozen=True)
class ParsedDice:
    """The parts of a dice expression. A dataclass is a class that is mostly data: Python writes the
    constructor and the == comparison for you. frozen=True makes it unchangeable once made."""

    count: int
    sides: int
    bonus: int


def ability_modifier(score: int) -> int:
    """10-11 is +0, 12-13 is +1, 8-9 is -1. Floor division (//) rounds toward negative infinity, as D&D needs."""
    return (score - 10) // 2


def format_signed(n: int) -> str:
    """4 becomes "+4", -1 becomes "-1", 0 becomes "+0"."""
    return f"+{n}" if n >= 0 else f"-{abs(n)}"


def parse_dice(expression: str) -> ParsedDice:
    """Parses "2d6", "4d8+8" or "1d6 - 1". Raises ValueError on anything else."""
    match = _DICE.fullmatch(expression.strip())
    if match is None:
        raise ValueError(f'Invalid dice expression: "{expression}"')
    count, sides, sign, amount = match.groups()
    bonus = int(amount) * (-1 if sign == "-" else 1) if amount else 0
    return ParsedDice(count=int(count), sides=int(sides), bonus=bonus)


def average_dice(expression: str, extra_bonus: int = 0) -> int:
    """The average of a dice expression plus a flat bonus, rounded down, as printed in stat blocks.

    Done in whole numbers: count * (sides + 1) / 2 is the average, so doubling everything and using // avoids
    floating point.
    """
    parsed = parse_dice(expression)
    return (parsed.count * (parsed.sides + 1) + 2 * (parsed.bonus + extra_bonus)) // 2


def format_damage_roll(dice: str, bonus: int) -> str:
    """"9 (2d6 + 2)" for a roll with a bonus, "3 (1d6)" without one."""
    average = average_dice(dice, bonus)
    if bonus == 0:
        return f"{average} ({dice})"
    sign = "+" if bonus > 0 else "-"
    return f"{average} ({dice} {sign} {abs(bonus)})"
