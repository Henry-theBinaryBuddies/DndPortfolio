"""Reflavor: new names for a monster's own abilities, with every number left exactly as it was.

The AI proposes the new names; this module decides which proposals are used. A proposal is used only when it names an
ability the monster really has (and one that is safe to rename), is a sensible length, is not a blocked name, and does not
collide with another ability. Everything the monster says about an ability by name is kept in step: the entries of its
Multiattack, and the Multiattack's own sentence.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from cauldron.actions import Action, MultiattackAction
from cauldron.blocklist import blocked_term
from cauldron.monster import Monster

ARROW = "→"
MAX_RENAMES = 12
MAX_NAME_LENGTH = 40

# Names that carry the rules themselves (or are headers), so they keep their wording.
_KEEP = {"multiattack", "spellcasting", "innate spellcasting", "legendary resistance", "legendary actions"}
_SUFFIX = re.compile(r"^(.*?)(\s*\([^)]*\))?$")


def split_name(name: str) -> tuple[str, str]:
    """"Enslave (3/Day)" gives ("Enslave", " (3/Day)"): the name and the usage note that must survive a rename."""
    match = _SUFFIX.match(name)
    assert match is not None  # the pattern matches any string
    return match.group(1).strip(), match.group(2) or ""


def _named(monster: Monster) -> list[Action]:
    return [*monster.all_actions(), *monster.traits]


def rename_candidates(monster: Monster) -> list[str]:
    """The abilities the AI may rename, by plain name (no usage note), in stat block order. At most MAX_RENAMES."""
    seen: dict[str, str] = {}
    for action in _named(monster):
        base, _ = split_name(action.name)
        if base and base.lower() not in _KEEP:
            seen.setdefault(base.lower(), base)
    return list(seen.values())[:MAX_RENAMES]


@dataclass(frozen=True)
class Reflavored:
    monster: Monster
    changes: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)  # for the AI, when a proposed name cannot be used at all


def _replace_word(text: str, old: str, new: str) -> str:
    """Whole-word, case-insensitive; a mention written in lower case stays lower case."""
    pattern = re.compile(r"(?<![A-Za-z])" + re.escape(old) + r"(?![A-Za-z])", re.IGNORECASE)
    return pattern.sub(lambda m: new.lower() if m.group(0) == m.group(0).lower() else new, text)


def apply_renames(monster: Monster, proposals: Sequence[tuple[str, str]]) -> Reflavored:
    """The monster with the usable proposed renames applied. Unusable ones are skipped, or (a blocked name) reported."""
    candidates = {name.lower(): name for name in rename_candidates(monster)}
    taken = {split_name(a.name)[0].lower() for a in _named(monster)}
    chosen: dict[str, str] = {}  # old name in lower case -> new name
    problems: list[str] = []
    for old, new in proposals:
        key, new = old.strip().lower(), " ".join(new.split())
        if key not in candidates or key in chosen or not 1 <= len(new) <= MAX_NAME_LENGTH:
            continue
        term = blocked_term(new)
        if term is not None:
            problems.append(f'The ability name "{new}" contains "{term}", which is not ours to use. Choose a different name.')
            continue
        # a new name may not collide with another ability, nor with another new name
        if new.lower() != key and (new.lower() in taken or new.lower() in {n.lower() for n in chosen.values()}):
            continue
        chosen[key] = new
    if problems:
        return Reflavored(monster, problems=problems)
    if not chosen:
        return Reflavored(monster)

    def renamed(name: str) -> str:
        base, suffix = split_name(name)
        return chosen[base.lower()] + suffix if base.lower() in chosen else name

    def action(a: Action) -> Action:
        update: dict[str, object] = {"name": renamed(a.name)}
        if isinstance(a, MultiattackAction):
            update["sequence"] = [e.model_copy(update={"action": renamed(e.action)}) for e in a.sequence]
            if a.text:
                text = a.text
                for key, new in chosen.items():
                    text = _replace_word(text, candidates[key], new)
                update["text"] = text
        return a.model_copy(update=update)

    result = monster.map_actions(action).model_copy(update={"traits": [action(t) for t in monster.traits]})  # type: ignore[misc]
    changes = [f"Renamed {candidates[key]} {ARROW} {new}" for key, new in chosen.items()]
    return Reflavored(result, changes)
