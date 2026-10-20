"""The human-readable import report, written next to the data so every import can be reviewed."""

from collections import Counter

from cauldron.actions import AttackAction, MultiattackAction, SaveAction, TextAction
from cauldron.seed.importer import ImportResult


def write_report(result: ImportResult) -> str:
    kinds = Counter(type(a).__name__ for m in result.monsters for a in m.all_actions())
    notes_by_check = Counter(f.check for findings in result.validator_notes.values() for f in findings)
    lines = [
        "# SRD import report",
        "",
        f"Monsters imported: **{len(result.monsters)}**. Excluded: {len(result.excluded)}. Rejected by the validator: {len(result.rejected)}.",
        "",
        "## Actions",
        "",
        "| Kind | Count |",
        "|---|---|",
        f"| Attacks (typed) | {kinds[AttackAction.__name__]} |",
        f"| Saves (typed) | {kinds[SaveAction.__name__]} |",
        f"| Multiattacks (typed counts, official wording) | {kinds[MultiattackAction.__name__]} |",
        f"| Text (kept word for word) | {kinds[TextAction.__name__]} |",
        "",
        f"Monsters with structured spellcasting: {sum(m.spellcasting is not None for m in result.monsters)}. "
        f"With an exact damage line kept as text: {sum(m.damage_text is not None for m in result.monsters)}.",
        "",
        "## Excluded",
        "",
    ]
    lines += [f"- `{index}`: {reason}" for index, reason in sorted(result.excluded.items())] or ["None."]
    lines += ["", "## Rejected", ""]
    lines += [f"- {name}: " + "; ".join(f.message for f in findings) for name, findings in result.rejected] or ["None."]
    lines += ["", "## Differences the importer corrected or noted", ""]
    lines += [f"- **{name}**: " + " ".join(notes) for name, notes in sorted(result.import_notes.items()) if not all("legendary actions per round" in n.lower() for n in notes)] or ["None."]
    lines += ["", "## Validator notes (official numbers are kept as printed)", ""]
    lines += [f"- {check}: {count} monsters" for check, count in sorted(notes_by_check.items())] or ["None."]
    lines += [""]
    return "\n".join(lines)
