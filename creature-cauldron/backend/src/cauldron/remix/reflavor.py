"""Reflavor: new names for a monster's own abilities, with every number left exactly as it was.

The AI proposes the new names; this module decides which proposals are used. A proposal is used only when it names an
ability the monster really has (and one that is safe to rename), is a sensible length, is not a blocked name, and does not
collide with another ability. Everything the monster says about an ability by name is kept in step: the entries of its
Multiattack, and the Multiattack's own sentence.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from cauldron.actions import Action, MultiattackAction, TextAction
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


def _norm(name: str) -> str:
    """A name as the CR measure and multiattacks spell it: no usage note, lower case, singular ("Claws" and "Claw" are one)."""
    return split_name(name)[0].lower().removesuffix("s")


def _prose_rewriter(chosen: dict[str, str], candidates: dict[str, str]):
    """A function that says the new names wherever prose used the old ones: whole words, one pass (so a new name that contains another
    old name is never rewritten again), plurals kept ("two with its claws" becomes "two with its talons"), lower case kept lower case."""
    names = sorted((candidates[key] for key in chosen), key=len, reverse=True)
    pattern = re.compile(r"(?<![A-Za-z])(" + "|".join(re.escape(n) for n in names) + r")(s?)(?![A-Za-z])", re.IGNORECASE)

    def say(text: str) -> str:
        def swap(match: re.Match[str]) -> str:
            new = chosen[match.group(1).lower()]
            plural = match.group(2) if not new.lower().endswith("s") else ""
            return (new.lower() if match.group(1) == match.group(1).lower() else new) + plural

        return pattern.sub(swap, text)

    return say


def apply_renames(monster: Monster, proposals: Sequence[tuple[str, str]]) -> Reflavored:
    """The monster with the usable proposed renames applied. Unusable ones are skipped, or (a blocked name) reported."""
    candidates = {name.lower(): name for name in rename_candidates(monster)}
    legendary = monster.legendary_actions.options if monster.legendary_actions is not None else []
    taken = {_norm(a.name) for a in _named(monster)} | {_norm(o.name) for o in legendary}
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
        # a new name may not collide with another ability or legendary option, nor with another new name
        if _norm(new) != _norm(key) and (_norm(new) in taken or _norm(new) in {_norm(n) for n in chosen.values()}):
            continue
        chosen[key] = new
    if problems:
        return Reflavored(monster, problems=problems)
    if not chosen:
        return Reflavored(monster)

    by_norm = {_norm(key): new for key, new in chosen.items()}
    say = _prose_rewriter(chosen, candidates)

    def renamed(name: str) -> str:
        base, suffix = split_name(name)
        new = by_norm.get(_norm(base))
        return new + suffix if new else name

    def action(a: Action) -> Action:
        update: dict[str, object] = {"name": renamed(a.name)}
        if isinstance(a, MultiattackAction):
            update["sequence"] = [e.model_copy(update={"action": renamed(e.action)}) for e in a.sequence]
            if a.text:
                update["text"] = say(a.text)
        elif isinstance(a, TextAction) and a.name.lower() == "multiattack":  # a Multiattack that stayed prose names its attacks too
            update["text"] = say(a.text)
        return a.model_copy(update=update)

    result = monster.map_actions(action).model_copy(update={"traits": [action(t) for t in monster.traits]})  # type: ignore[misc]
    if monster.legendary_actions is not None:
        options = [o.model_copy(update={"name": say(o.name), "text": say(o.text)}) for o in legendary]
        result = result.model_copy(update={"legendary_actions": monster.legendary_actions.model_copy(update={"options": options})})
    changes = [f"Renamed {candidates[key]} {ARROW} {new}" for key, new in chosen.items()]
    return Reflavored(result, changes)
