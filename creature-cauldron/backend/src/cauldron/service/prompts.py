"""The prompts sent to the model, built only from fixed values.

Nothing a visitor typed can reach a prompt, because visitors can only pick from fixed lists (see ``models.py``). Even so,
the only text that is not a fixed value is the validator's feedback from the previous attempt, and that is cleaned before use:
shortened, put on one line and limited in number, so a strange monster name cannot smuggle in new instructions.

Prompts are plain functions of their inputs, so the same inputs always give the same prompt and tests can check them.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from cauldron.service.brief import Brief

MAX_FEEDBACK_LINES = 5
MAX_FEEDBACK_LENGTH = 300

TOOL_NAME = "submit_monster"

_RULES = f"""You design original monsters for the 2014 (5th edition) fantasy tabletop role-playing game, for a party's own use.

Rules you must follow:
- Return the monster only by calling the {TOOL_NAME} tool. Write no other text.
- The monster must be ORIGINAL. Do not copy or imitate any creature from the Monster Manual, Volo's Guide, Mordenkainen's, or any
  other published book, and do not use any name, character, deity or setting from a published game or fiction.
- Use the 2014 rules and the 2014 stat block conventions. Keep the numbers sensible for the challenge rating you are given.
- Build attacks and saving throws as typed actions where you can; use text actions for anything unusual.
- Give the monster a short evocative description of one or two sentences, and a name that is new and not a real-world word for a species.
- Avoid the most obvious version of the creature type. Vary the imagery, the damage types and the tactics from one monster to the next.
- Do not add anything about the game's publisher or about licences."""

_NAME_RULES = """You write names and descriptions for monsters in the 2014 fantasy tabletop role-playing game.

Rules you must follow:
- Reply only by calling the submit_name tool. Write no other text.
- Write ONLY a new name and a short description of one or two sentences, plus a name for the new move or new names for its
  abilities when you are asked for them. Do not change or mention any numbers.
- Names must be original: not a creature, character, deity, place, spell or ability from any published game or fiction.
- Keep the description consistent with what changed about the monster, and with its new move if it has one."""


@dataclass(frozen=True)
class Prompt:
    system: str
    user: str


@dataclass(frozen=True)
class RenameContext:
    """What the model is told about a reskin. All of it comes from the server's own library, never from a visitor."""

    base_name: str
    base_description: str
    creature_type: str
    size: str
    cr: str
    changes: tuple[str, ...]  # for example "Damage swap: fire to cold" or "Level up: CR 4 to CR 5, with more hit points"
    theme: str | None = None  # the new damage theme of a remix, for example "cold"
    move_label: str | None = None  # a remix's new signature move, for example "ranged lob"
    move_blurb: str | None = None
    reflavor: bool = False  # a new look only: no number changes
    rename_candidates: tuple[str, ...] = ()  # the abilities the AI may give new names to
    avoid_names: tuple[str, ...] = ()  # the names of the new looks already made, so this one differs
    donor_name: str | None = None  # a polymorph: the creature the features come from
    donor_description: str | None = None
    graft_options: tuple[tuple[str, str], ...] = ()  # (key, label) of what the AI may pick from when the forge chooses


def clean_feedback(feedback: Sequence[str]) -> list[str]:
    """Feedback shortened to one line each, and only the first few."""
    cleaned = []
    for line in list(feedback)[:MAX_FEEDBACK_LINES]:
        one_line = " ".join(line.split())
        cleaned.append(one_line[:MAX_FEEDBACK_LENGTH])
    return cleaned


def _feedback_block(feedback: Sequence[str]) -> str:
    lines = clean_feedback(feedback)
    if not lines:
        return ""
    bullets = "\n".join(f"- {line}" for line in lines)
    return f"\n\nProblems with the previous attempt. Fix these in the new monster:\n{bullets}"


def generate_prompt(brief: Brief, feedback: Sequence[str]) -> Prompt:
    lines = [
        f"Design one monster of challenge rating CR {brief.cr}.",
        f"- Creature type: {brief.type.value}",
        f"- Size: {brief.size.value}",
        f"- Home environment: {brief.environment.value}",
        f"- Battlefield role: {brief.role.value}",
    ]
    if brief.damage_theme is not None:
        lines.append(f"- Damage theme: {brief.damage_theme.value} (its main attacks or abilities deal {brief.damage_theme.value} damage)")
    else:
        # Left alone, the model reaches for fire and ember imagery almost every time (seen in the first real runs).
        lines.append("- Damage theme: none chosen. Pick what truly suits the creature, and do not default to fire, embers or cinders.")
    if brief.features:
        lines.append(f"- It must have these features: {', '.join(f.value for f in brief.features)}")
    return Prompt(system=_RULES, user="\n".join(lines) + _feedback_block(feedback))


def _reflavor_prompt(context: RenameContext) -> str:
    lines = [f"A monster called {context.base_name} ({context.size} {context.creature_type}, CR {context.cr}) is being given a completely new look. All its numbers stay exactly the same."]
    lines.append(f"Its original description: {context.base_description}")
    if context.avoid_names:
        lines.append(f"New looks already made for it: {', '.join(context.avoid_names)}. Make this one clearly different from them.")
    lines.append("Choose one fresh theme that suits it (not the most obvious one) and keep to it. Write a new name and a new short description.")
    if context.rename_candidates:
        lines.append(
            "Also rename these abilities to fit the new look, as old/new pairs in `renames`: "
            + "; ".join(context.rename_candidates)
            + ". Keep each new name to one to four words, and keep it clear what the ability does."
        )
    return "\n".join(lines)


def _graft_prompt(context: RenameContext) -> str:
    lines = [
        f"A monster called {context.base_name} ({context.size} {context.creature_type}, CR {context.cr}) is being polymorphed: "
        f"it takes on features of another creature, {context.donor_name}."
    ]
    lines.append(f"{context.base_name}: {context.base_description}")
    lines.append(f"{context.donor_name}: {context.donor_description}")
    if context.graft_options:
        lines.append(
            "Pick the features that make the best, most coherent hybrid, one to four of them, as their keys exactly as written in `picks`:"
        )
        lines += [f"- {key}: {label}" for key, label in context.graft_options]
        lines.append("Then write a new name and a short description for the hybrid as it will be with those features.")
    else:
        lines.append(f"What it borrowed: {'; '.join(context.changes)}.")
        lines.append("Write a new name and a short description for the hybrid. Do not mention numbers.")
    return "\n".join(lines)


def rename_prompt(context: RenameContext, feedback: Sequence[str]) -> Prompt:
    if context.donor_name is not None:
        return Prompt(system=_NAME_RULES, user=_graft_prompt(context) + _feedback_block(feedback))
    if context.reflavor:
        return Prompt(system=_NAME_RULES, user=_reflavor_prompt(context) + _feedback_block(feedback))
    changes = "; ".join(context.changes)
    lines = [f"A monster called {context.base_name} ({context.size} {context.creature_type}, CR {context.cr}) has been changed: {changes}."]
    if context.theme is not None:
        lines.append(f"Its new damage theme is {context.theme}: its attacks and abilities now deal {context.theme} damage.")
    if context.move_label is not None:
        lines.append(f"It also has a new signature move, a {context.move_label} ({context.move_blurb}).")
    lines.append(f"Its original description: {context.base_description}")
    lines.append("Write a new name and a new short description for the changed monster.")
    if context.move_label is not None:
        lines.append("Also give the new move a short name of one to four words, as move_name. It should suit the new theme.")
    user = "\n".join(lines)
    return Prompt(system=_NAME_RULES, user=user + _feedback_block(feedback))
