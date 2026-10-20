"""Rules tables, all taken from the System Reference Document 5.1 (CC-BY-4.0), pages 256 to 258.

Only tables the SRD actually contains are here. The Dungeon Master's Guide's "Monster Statistics by Challenge
Rating" table is not in the SRD, so it is deliberately not used (see docs/REQUIREMENTS.md).
"""

import math

from cauldron.options import Size

# The attribution statement the SRD requires, word for word (SRD 5.1, "Legal Information").
SRD_ATTRIBUTION = (
    "This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the "
    "Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed "
    "under the Creative Commons Attribution 4.0 International License available at "
    "https://creativecommons.org/licenses/by/4.0/legalcode."
)

# Experience points by challenge rating (SRD 5.1, page 258). CR 0 is "0 or 10"; 10 is used, as the front end does.
XP_BY_CR: dict[str, int] = {
    "0": 10,
    "1/8": 25,
    "1/4": 50,
    "1/2": 100,
    "1": 200,
    "2": 450,
    "3": 700,
    "4": 1100,
    "5": 1800,
    "6": 2300,
    "7": 2900,
    "8": 3900,
    "9": 5000,
    "10": 5900,
    "11": 7200,
    "12": 8400,
    "13": 10000,
    "14": 11500,
    "15": 13000,
    "16": 15000,
    "17": 18000,
    "18": 20000,
    "19": 22000,
    "20": 25000,
    "21": 33000,
    "22": 41000,
    "23": 50000,
    "24": 62000,
    "25": 75000,
    "26": 90000,
    "27": 105000,
    "28": 120000,
    "29": 135000,
    "30": 155000,
}

# Every challenge rating, lowest to highest. A dict keeps its keys in the order they were written.
CR_LABELS: list[str] = list(XP_BY_CR)

# Hit die by size (SRD 5.1, page 256).
_HIT_DIE: dict[Size, int] = {
    Size.TINY: 4,
    Size.SMALL: 6,
    Size.MEDIUM: 8,
    Size.LARGE: 10,
    Size.HUGE: 12,
    Size.GARGANTUAN: 20,
}


def cr_value(label: str) -> float:
    """"1/8" gives 0.125, "12" gives 12. Raises ValueError for anything that is not a challenge rating."""
    if label not in XP_BY_CR:
        raise ValueError(f'"{label}" is not a challenge rating')
    if "/" in label:
        top, bottom = label.split("/")
        return int(top) / int(bottom)
    return float(int(label))


def xp_for_cr(label: str) -> int:
    return XP_BY_CR[label]


def proficiency_bonus(label: str) -> int:
    """+2 up to CR 4, then one more for every four challenge ratings, up to +9 at CR 29 and 30 (SRD 5.1, page 256)."""
    value = cr_value(label)
    return 2 + max(0, math.ceil(value) - 1) // 4


def hit_die(size: Size) -> int:
    return _HIT_DIE[size]


def step_cr(label: str, steps: int) -> str:
    """The challenge rating `steps` places along the ladder, stopping at 0 and 30."""
    index = CR_LABELS.index(label) + steps
    return CR_LABELS[max(0, min(index, len(CR_LABELS) - 1))]
