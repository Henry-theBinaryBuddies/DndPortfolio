"""The A5E importer: Monstrous Menagerie creatures from Open5e to validated Monsters. ``python -m cauldron.seed.a5e``.

Open5e serves the creatures in its own shape. ``convert`` rewrites one record into the shape of the SRD data file, so that the
SRD importer (``import_monster``) does the real work and both libraries are parsed by the same code. What is deliberately NOT
taken: art, cross references, and the long prose paragraphs Open5e files among the actions (lore and notes, not abilities).
Statistics and ability text only.

A creature that shares its name with one already in the library is called "Name (A5E)", so every name stays unique.
"""

import argparse
import json
import re
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from cauldron.dice import ability_modifier
from cauldron.monster import Monster
from cauldron.options import Size, Source
from cauldron.rules import A5E_ATTRIBUTION, hit_die
from cauldron.seed.importer import ImportResult, import_monster
from cauldron.validator import Status, ValidationContext, Validator

PROJECT = Path(__file__).resolve().parents[4]  # the creature-cauldron folder
RAW = PROJECT / "backend" / "data" / "a5e-mm" / "open5e-a5e-mm.json"
OUT = PROJECT / "frontend" / "public" / "data" / "a5e-monsters.json"
REPORT = PROJECT / "backend" / "data" / "a5e-import-report.md"
API = "https://api.open5e.com/v2/creatures/?document__key=a5e-mm&limit=100&page={page}"
MAX_ENTRY_NAME = 60  # longer "names" are paragraphs of lore or notes, not abilities
MAX_SIGHT = 1000  # a sense longer than this is a data error
SUFFIX = " (A5E)"
_DEBRIS = re.compile(r"^\d|Weapon Attack")  # "8 Scorpion Tail Melee Weapon Attack: +5 to hit": a stat block line, not an ability name
_NUMBER = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a": 1, "an": 1}
_SIZES = {"titanic": "gargantuan"}  # A5E has a size above gargantuan; the model has none


@dataclass
class A5eResult(ImportResult):
    renamed: list[str] = field(default_factory=list)  # names that got the (A5E) suffix
    skipped: dict[str, str] = field(default_factory=dict)  # record key -> why it was not imported


# --- fetching -------------------------------------------------------------------------------------------


def slim(record: dict) -> dict:
    """The record without what we never use: art, cross references, and lore paragraphs filed among the actions."""
    kept = {k: v for k, v in record.items() if k not in ("illustration", "crossreferences", "document")}
    for kind in ("actions", "traits"):
        kept[kind] = [
            {k: v for k, v in e.items() if k != "crossreferences"}
            for e in record.get(kind, [])
            if 0 < len(e["name"]) <= MAX_ENTRY_NAME and e.get("desc", "").strip() and not _DEBRIS.search(e["name"])
        ]
    return kept


def fetch(pages: int = 10) -> list[dict]:
    """Every Monstrous Menagerie creature from Open5e, slimmed. Network access; only the --fetch option calls this."""
    records: list[dict] = []
    for page in range(1, pages + 1):
        response = urllib.request.urlopen(API.format(page=page), timeout=60)  # noqa: S310 - a fixed https address
        with response:
            data = json.load(response)
        records += [slim(r) for r in data["results"]]
        if not data.get("next"):
            break
    return records


# --- converting -----------------------------------------------------------------------------------------


_POSSESSIVE = re.compile(r"\bThe ([A-Za-z ]+?)s (spellcasting ability)")


def clean(desc: str) -> str:
    """Open5e's text is lightly marked up (underscores and stars for emphasis, "- " bullet lines, blank lines) and writes dice as
    "2d6+8"; the stat block shows plain sentences and the SRD parser expects "2d6 + 8". Bullets (A5E's spell lists) are joined into one
    sentence with semicolons. Open5e also drops the apostrophe from "The aboleth's spellcasting ability"; that stock phrase is restored."""
    text = desc.replace("_", "").replace("*", "").replace("\u2019", "'")
    text = re.sub(r"(?<=[\w)])  (?=\w)", ", ", text)  # Open5e turned each comma into a space, leaving two: "On a failure  it takes"
    text = re.sub(r"(\d+d\d+)([+-])(\d+)", lambda m: f"{m.group(1)} {m.group(2)} {m.group(3)}", text)
    parts: list[str] = []
    bullets: list[str] = []
    for line in (ln.strip() for ln in text.split("\n")):
        if not line:
            continue
        if line.startswith("- "):
            bullets.append(line[2:].strip())
            continue
        if bullets:
            parts.append("; ".join(bullets))
            bullets = []
        parts.append(line)
    if bullets:
        parts.append("; ".join(bullets))
    text = " ".join(parts)
    if text and text[-1].isalnum() and "\n" in desc:
        text += "."  # a list that ended without a full stop
    return _POSSESSIVE.sub(r"The \1's \2", text).strip()


def _feet(n: float) -> str:
    return f"{int(n)} ft."


def _hit_dice(record: dict) -> tuple[int, int, str]:
    """The creature's hit dice as (count, sides, printed): the record's own when it gives them ("18d10+72"), else worked out as many
    dice of the size's type as the average hit points imply."""
    own = re.fullmatch(r"(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?", (record.get("hit_dice") or "").strip())
    if own:
        count, sides = int(own[1]), int(own[2])
        bonus = int(own[4] or 0) * (-1 if own[3] == "-" else 1)
        return count, sides, f"{count}d{sides}" + (f" + {bonus}" if bonus > 0 else f" - {-bonus}" if bonus < 0 else "")
    sides = hit_die(Size(_SIZES.get(record["size"]["key"], record["size"]["key"])))
    con = record["modifiers"]["constitution"]
    per_die = (sides + 1) / 2 + con
    count = max(1, round(record["hit_points"] / per_die)) if per_die > 0 else 1
    bonus = con * count
    roll = f"{count}d{sides}" + (f" + {bonus}" if bonus > 0 else f" - {-bonus}" if bonus < 0 else "")
    return count, sides, roll


_COUNT = r"(?P<count>once|twice|one|two|three|four|five|six|an?|\d+)(?: times)?"
_OWNER = r"(?:its|their|his|her|the)"
_CLAUSES = (
    re.compile(rf"^{_COUNT} (?:attacks? )?with {_OWNER} (?P<name>[a-z' -]+?)(?: attacks?)?$"),  # "twice with its claws", "two attacks with its claws"
    re.compile(rf"^{_COUNT} (?P<name>[a-z' -]+?) attacks?$"),  # "two greatsword attacks"
    re.compile(rf"^(?:with )?{_OWNER} (?P<name>[a-z' -]+?)$"),  # "with its beak", "its talons" (once each)
)
_CHOICE = re.compile(r"\b(or|either|alternatively|any combination|only one|neither|instead|different|in place)\b")


def _plain(name: str) -> str:
    return re.sub(r"\s*\(.*?\)", "", name).strip().lower().removesuffix("s")


def _multiattack_sequence(desc: str, actions: list[dict]) -> list[dict]:
    """The attacks of a Multiattack, but only when its first sentence is one of the plain forms ("attacks once with its bite and
    twice with its claws", "makes two greatsword attacks", "makes three attacks: two with its claws and one with its tail") and every
    attack named is one of the creature's actions. A sentence that offers a choice, replaces an attack or names nothing stays
    text: a wrong count would price the creature wrongly, and the printed sentence is always kept."""
    sentence = " ".join(re.split(r"\.\s", desc.replace("_", "").strip().lower(), maxsplit=1)[0].rstrip(".").split())
    if _CHOICE.search(sentence):
        return []
    match = re.match(r"^the [a-z' -]+? (?:attacks|makes) (.*)$", sentence)
    if match is None:
        return []
    body = match.group(1).split(":", 1)[-1].strip()
    by_name = {_plain(a["name"]): a["name"] for a in actions if a["name"] != "Multiattack"}
    counts: dict[str, int] = {}
    for clause in (c for c in re.split(r"\s*(?:,|\band then\b|\bthen\b|\band\b)\s*", body) if c):
        for pattern in _CLAUSES:
            found = pattern.match(clause)
            if found:
                break
        else:
            return []
        action = by_name.get(_plain(found["name"]))
        if action is None:
            return []
        count = found.groupdict().get("count") or "one"
        counts[action] = counts.get(action, 0) + (_NUMBER.get(count) or (2 if count == "twice" else 1 if count == "once" else int(count)))
    return [{"action_name": name, "count": str(count), "type": "melee"} for name, count in counts.items()]


def _damage_list(record: dict, kind: str) -> list[str]:
    info = record["resistances_and_immunities"]
    keys = [e["key"] for e in info[f"damage_{kind}"]]
    display = info[f"damage_{kind}_display"].lower()
    if "nonmagical" in display:
        physical = [t for t in ("bludgeoning", "piercing", "slashing") if t in display.split("nonmagical")[0]]
        rest = [k for k in keys if k not in ("bludgeoning", "piercing", "slashing")]
        joined = physical[0] if len(physical) == 1 else f"{physical[0]} and {physical[1]}" if len(physical) == 2 else "bludgeoning, piercing, and slashing"
        return [*rest, f"{joined} from nonmagical attacks"]
    return keys


def _unglue(name: str, desc: str) -> tuple[str, str]:
    """An entry whose "name" has swallowed the start of its text ("Healing: The creature magically regains 21 hit points"): the words
    before the colon are the name. (A short name with a colon, "Curse: Mummy Rot", is a real name and is left alone.)"""
    head, _, lead = name.partition(": ")
    return (head, f"{lead} {desc}") if lead and len(name) > 30 else (name, desc)


def _trait(entry: dict) -> dict:
    name, desc = _unglue(entry["name"], entry["desc"])
    return {"name": name, "desc": clean(desc)}


def convert(record: dict) -> dict:
    """One Open5e creature as an entry of the SRD data file."""
    mods, scores = record["modifiers"], record["ability_scores"]
    size = _SIZES.get(record["size"]["key"], record["size"]["key"])
    count, sides, roll = _hit_dice(record)
    speed_all = record["speed_all"]
    speed = {k: _feet(v) for k, v in speed_all.items() if k in ("walk", "fly", "swim", "climb", "burrow") and v}
    speed.setdefault("walk", "0 ft.")
    if speed_all.get("hover"):
        speed["hover"] = True
    senses = {
        key.replace("_range", ""): _feet(record[key])
        for key in ("darkvision_range", "blindsight_range", "tremorsense_range", "truesight_range")
        if record.get(key) and record[key] <= MAX_SIGHT
    }
    senses["passive_perception"] = record["passive_perception"]
    saves = [
        {"value": value, "proficiency": {"index": f"saving-throw-{ability[:3]}", "name": f"Saving Throw: {ability[:3].upper()}"}}
        for ability, value in record["saving_throws"].items()
        if value != mods[ability]
    ]
    skills = [
        {"value": value, "proficiency": {"index": f"skill-{name}", "name": f"Skill: {name.replace('_', ' ').title()}"}}
        for name, value in record["skill_bonuses"].items()
    ]

    actions, bonus_actions, reactions, legendary = [], [], [], []
    per_round = None
    for a in sorted(record["actions"], key=lambda a: a.get("order_in_statblock") or 0):
        name, desc = _unglue(a["name"], a["desc"])
        entry = {"name": name, "desc": clean(desc)}
        usage = a.get("usage_limits")
        if usage and usage["type"] == "RECHARGE_ON_ROLL":
            entry["usage"] = {"type": "recharge on roll", "dice": "1d6", "min_value": usage["param"]}
        elif usage and usage["type"] == "PER_DAY":
            entry["usage"] = {"type": "per day", "times": usage["param"]}
        kind = a["action_type"]
        if kind == "LEGENDARY_ACTION":
            intro = re.search(r"can take (\d) legendary actions?", name)
            if intro:  # "The dragon can take 3 legendary actions...": how many a round, not an option
                per_round = int(intro.group(1))
                continue
            cost = a.get("legendary_action_cost") or 1
            if usage and usage["type"] == "PER_DAY":
                name += f" ({usage['param']}/Day)"
            elif usage and usage["type"] == "RECHARGE_ON_ROLL":
                name += f" (Recharge {usage['param']}-6)" if usage["param"] < 6 else " (Recharge 6)"
            legendary.append({"name": name + (f" (Costs {cost} Actions)" if cost > 1 else ""), "desc": entry["desc"]})
        elif kind == "REACTION":
            reactions.append(entry)
        elif kind == "BONUS_ACTION":
            bonus_actions.append(entry)
        else:
            if re.search(r"\(Costs \d Actions?\)$", name):
                continue  # Open5e repeats each costed legendary option among the plain actions
            if name == "Multiattack":
                entry["multiattack_type"] = "actions"
                entry["actions"] = _multiattack_sequence(entry["desc"], record["actions"])
            actions.append(entry)

    return {
        "index": re.sub(r"^a5e-mm_", "a5e-", record["key"]).replace("_", "-"),
        "name": record["name"],
        "size": size,
        "type": record["type"]["key"],
        "alignment": record["alignment"],
        "armor_class": [{"type": "natural", "value": record["armor_class"]}],
        "hit_points": record["hit_points"],
        "hit_dice": f"{count}d{sides}",
        "hit_points_roll": roll,
        "speed": speed,
        "strength": scores["strength"],
        "dexterity": scores["dexterity"],
        "constitution": scores["constitution"],
        "intelligence": scores["intelligence"],
        "wisdom": scores["wisdom"],
        "charisma": scores["charisma"],
        "proficiencies": saves + skills,
        "damage_vulnerabilities": _damage_list(record, "vulnerabilities"),
        "damage_resistances": _damage_list(record, "resistances"),
        "damage_immunities": _damage_list(record, "immunities"),
        "condition_immunities": [{"index": c["key"], "name": c["name"]} for c in record["resistances_and_immunities"]["condition_immunities"]],
        "senses": senses,
        "languages": record["languages"]["as_string"],
        "challenge_rating": float(record["challenge_rating"]),
        "proficiency_bonus": record.get("proficiency_bonus") or 2,
        "xp": record["experience_points"] or 0,
        "special_abilities": [_trait(t) for t in record["traits"]],
        "actions": [*actions, *bonus_actions],
        "reactions": reactions,
        "legendary_actions": legendary or None,
        "legendary_per_round": per_round,
        "desc": "",
    }


# --- importing ------------------------------------------------------------------------------------------


def import_a5e(records: list[dict], taken_names: frozenset[str] = frozenset()) -> A5eResult:
    """Every record converted, imported and validated. `taken_names` are the library's names already in use (lower case)."""
    result = A5eResult()
    validator = Validator()
    names = set(taken_names)
    for record in records:
        key = record["key"]
        try:
            imported = import_monster(convert(record), source=Source.A5E, attribution=A5E_ATTRIBUTION, id_prefix="a5e")
        except Exception as problem:  # noqa: BLE001 - one bad record must not stop the other 585
            result.skipped[key] = f"{type(problem).__name__}: {str(problem).splitlines()[0][:120]}"
            continue
        monster = imported.monster
        # The importer's ids are "a5e-" + the index, and the index already starts with "a5e-"; keep one prefix.
        monster = monster.model_copy(update={"id": monster.id.replace("a5e-a5e-", "a5e-", 1)})
        if monster.name.lower() in names:
            monster = monster.model_copy(update={"name": monster.name + SUFFIX})
            result.renamed.append(monster.name)
        report = validator.validate(monster, ValidationContext(existing_names=frozenset(names)))
        if imported.notes:
            result.import_notes[monster.name] = imported.notes
        if report.notes:
            result.validator_notes[monster.name] = report.notes
        if report.status is Status.REJECTED:
            result.rejected.append((monster.name, report.errors))
            continue
        names.add(monster.name.lower())
        result.monsters.append(report.monster)
    return result


def write_report(result: A5eResult) -> str:
    lines = [
        "# A5E import report",
        "",
        f"Monsters imported: **{len(result.monsters)}**. Called \"Name (A5E)\" because the name was taken: {len(result.renamed)}. "
        f"Skipped: {len(result.skipped)}. Rejected by the validator: {len(result.rejected)}.",
        "",
        "## Skipped",
        "",
        *([f"- `{key}`: {why}" for key, why in sorted(result.skipped.items())] or ["None."]),
        "",
        "## Rejected",
        "",
        *([f"- {name}: " + "; ".join(f.message for f in findings) for name, findings in result.rejected] or ["None."]),
        "",
    ]
    return "\n".join(lines)


def library_names(frontend_data: Path) -> frozenset[str]:
    """The names already used by the SRD and sample files (lower case)."""
    names: set[str] = set()
    for file in ("sample-monsters.json", "srd-monsters.json"):
        path = frontend_data / file
        if path.exists():
            names |= {m["name"].lower() for m in json.loads(path.read_text(encoding="utf-8"))}
    return frozenset(names)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the A5E Monstrous Menagerie creatures from Open5e.")
    parser.add_argument("--fetch", action="store_true", help="download the creatures from Open5e first (network), saving them to --raw")
    parser.add_argument("--raw", type=Path, default=RAW)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--report", type=Path, default=REPORT)
    args = parser.parse_args()

    if args.fetch:
        records = fetch()
        args.raw.parent.mkdir(parents=True, exist_ok=True)
        args.raw.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"Saved {len(records)} creatures to {args.raw}")
    records = [slim(r) for r in json.loads(args.raw.read_text(encoding="utf-8"))]  # slimming twice changes nothing
    result = import_a5e(records, library_names(args.out.parent))
    payload = [m.model_dump(mode="json", exclude_none=True) for m in result.monsters]
    args.out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    args.report.write_text(write_report(result), encoding="utf-8")
    print(f"Wrote {len(payload)} monsters to {args.out} ({len(result.renamed)} renamed, {len(result.skipped)} skipped, {len(result.rejected)} rejected)")


if __name__ == "__main__":
    main()
