"""Damage vulnerability, resistance and immunity lines.

The SRD prints lines such as "bludgeoning, piercing, and slashing from nonmagical weapons". A plain list of damage
types cannot say "from nonmagical weapons", and that qualifier changes the rules, so when a line has one we keep
the types (for searching and for the damage swap) and also keep the exact printed wording in ``damage_text``.
"""

import re

from cauldron.options import DamageType

_TYPES = {t.value for t in DamageType}
_WORD = re.compile(r"[a-z]+")


def parse_damage_line(entries: list[str]) -> tuple[list[DamageType], str | None]:
    """The damage types named in a line, and the exact wording when it is more than a plain list of types.

    ``entries`` is the list from the data, for example ["fire", "bludgeoning, piercing, and slashing from
    nonmagical weapons"]. The wording is returned only when some entry is not a single plain type.
    """
    types: list[DamageType] = []
    plain = True
    for entry in entries:
        if entry in _TYPES:
            found = [DamageType(entry)]
        else:
            plain = False
            # Only the words before the qualifier ("from ...") name types: "piercing and slashing from nonmagical ...".
            head = entry.split(" from ")[0]
            found = [DamageType(word) for word in _WORD.findall(head) if word in _TYPES]
        for damage_type in found:
            if damage_type not in types:
                types.append(damage_type)
    text = None if plain else "; ".join(entries)
    return types, text
