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
- Do not add anything about the game's publisher or about licences."""

_NAME_RULES = """You write names and descriptions for monsters in the 2014 fantasy tabletop role-playing game.

Rules you must follow:
- Reply only by calling the submit_name tool. Write no other text.
- Write ONLY a new name and a short description of one or two sentences. Do not change or mention any numbers.
- The name must be original: not a creature, character, deity or place from any published game or fiction.
- Keep the description consistent with what changed about the monster."""


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
    changes: tuple[str, ...]  # for example "its fire damage became cold damage" or "it is a stronger, elite version"


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
    if brief.features:
        lines.append(f"- It must have these features: {', '.join(f.value for f in brief.features)}")
    return Prompt(system=_RULES, user="\n".join(lines) + _feedback_block(feedback))


def rename_prompt(context: RenameContext, feedback: Sequence[str]) -> Prompt:
    changes = "; ".join(context.changes)
    user = (
        f"A monster called {context.base_name} ({context.size} {context.creature_type}, CR {context.cr}) has been changed: {changes}.\n"
        f"Its original description: {context.base_description}\n"
        "Write a new name and a new short description for the changed monster."
    )
    return Prompt(system=_NAME_RULES, user=user + _feedback_block(feedback))
