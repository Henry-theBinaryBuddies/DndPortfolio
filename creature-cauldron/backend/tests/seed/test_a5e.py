"""The A5E importer: Open5e records into validated Monsters, and the committed library file that came out of it."""

import io
import json
from pathlib import Path

import pytest

from cauldron.monster import Monster
from cauldron.options import Source
from cauldron.rules import A5E_ATTRIBUTION, SRD_ATTRIBUTION
from cauldron.seed import a5e
from cauldron.validator import Outcome, Validator

DATA = Path(__file__).parents[3] / "frontend" / "public" / "data"
RAW = json.loads(a5e.RAW.read_text(encoding="utf-8"))


def record(key: str) -> dict:
    return next(r for r in RAW if r["key"] == key)


# --- slimming and fetching ----------------------------------------------------------------------------------


def test_slim_drops_art_cross_references_and_lore_paragraphs() -> None:
    raw = {
        "key": "a5e-mm_x",
        "illustration": "https://example.test/art.png",
        "crossreferences": [],
        "document": {"name": "Monstrous Menagerie"},
        "actions": [
            {"name": "Bite", "desc": "A bite.", "crossreferences": {}},
            {"name": "An acolyte is a priest in training or an assistant to a more senior member of the clergy", "desc": "Lore text."},
            {"name": "Empty", "desc": "  "},
        ],
        "traits": [{"name": "Keen Senses", "desc": "Sharp."}],
    }
    slimmed = a5e.slim(raw)
    assert "illustration" not in slimmed and "crossreferences" not in slimmed and "document" not in slimmed
    assert [x["name"] for x in slimmed["actions"]] == ["Bite"] and "crossreferences" not in slimmed["actions"][0]
    assert [x["name"] for x in slimmed["traits"]] == ["Keen Senses"]


def test_fetch_follows_the_pages_until_there_are_no_more(monkeypatch) -> None:
    pages = [{"results": [{"key": "a", "actions": [], "traits": []}], "next": "page2"}, {"results": [{"key": "b", "actions": [], "traits": []}], "next": None}]
    asked: list[str] = []

    def fake_urlopen(url, timeout):  # noqa: ANN001
        asked.append(url)
        return io.StringIO(json.dumps(pages[len(asked) - 1]))

    monkeypatch.setattr(a5e.urllib.request, "urlopen", fake_urlopen)
    assert [r["key"] for r in a5e.fetch()] == ["a", "b"]
    assert len(asked) == 2 and "document__key=a5e-mm" in asked[0] and asked[1].endswith("page=2")


# --- converting ------------------------------------------------------------------------------------------


def test_text_is_made_plain_for_the_srd_parser() -> None:
    assert a5e.clean("_Melee Weapon Attack:_ +9 to hit. _Hit:_ 19 (4d6+5) bludgeoning damage.") == "Melee Weapon Attack: +9 to hit. Hit: 19 (4d6 + 5) bludgeoning damage."


def test_markdown_lists_become_plain_sentences() -> None:
    text = "It can innately cast the following spells:\n\n- **3/Day Each:** Detect Thoughts, Project Image\n- **1/Day Each:** Dominate Monster\n\nIt never tires."
    assert a5e.clean(text) == "It can innately cast the following spells: 3/Day Each: Detect Thoughts, Project Image; 1/Day Each: Dominate Monster It never tires."
    assert a5e.clean("- **Cantrips** (at will): Mending") == "Cantrips (at will): Mending"
    assert a5e.clean("The aboleths spellcasting ability is Charisma. Its bite hits.") == "The aboleth's spellcasting ability is Charisma. Its bite hits."
    assert a5e.clean("Its spellcasting ability is Wisdom.") == "Its spellcasting ability is Wisdom."  # "its" is not a possessive to repair


def test_an_aboleth_is_imported_with_a_typed_attack_and_the_a5e_credit() -> None:
    result = a5e.import_a5e([record("a5e-mm_aboleth")])
    aboleth = result.monsters[0]
    assert aboleth.id == "a5e-aboleth" and aboleth.source is Source.A5E and aboleth.attribution == A5E_ATTRIBUTION
    assert aboleth.challenge.cr == "11" and aboleth.hit_points.average == 171
    tentacle = next(a for a in aboleth.actions if a.name == "Tentacle")
    assert tentacle.kind == "attack" and tentacle.attack.to_hit == 9  # type: ignore[union-attr]
    assert aboleth.description == ""  # no lore comes with the statistics


def test_a_name_already_in_the_library_gets_the_a5e_suffix() -> None:
    plain = a5e.import_a5e([record("a5e-mm_aboleth")]).monsters[0]
    taken = a5e.import_a5e([record("a5e-mm_aboleth")], frozenset({"aboleth"}))
    assert plain.name == "Aboleth" and taken.monsters[0].name == "Aboleth (A5E)" and taken.renamed == ["Aboleth (A5E)"]


def test_a_record_that_cannot_be_imported_is_skipped_and_reported_not_fatal() -> None:
    broken = {**record("a5e-mm_aboleth"), "key": "a5e-mm_broken", "ability_scores": {"strength": "x"}}
    result = a5e.import_a5e([broken, record("a5e-mm_aboleth")])
    assert len(result.monsters) == 1 and "a5e-mm_broken" in result.skipped


def test_the_largest_size_becomes_gargantuan() -> None:
    titanic = next(r for r in RAW if r["size"]["key"] == "titanic")
    assert a5e.import_a5e([titanic]).monsters[0].size.value == "gargantuan"


# --- the validator knows the source ---------------------------------------------------------------------------


def test_an_a5e_monster_must_carry_the_exact_credit_and_keeps_its_printed_numbers() -> None:
    aboleth = a5e.import_a5e([record("a5e-mm_aboleth")]).monsters[0]
    assert Validator().validate(aboleth).status.value != "rejected"
    wrong = aboleth.model_copy(update={"attribution": "Somebody else's credit."})
    report = Validator().validate(wrong)
    assert any(f.outcome is Outcome.REJECT and "A5E credit" in f.message for f in report.findings)
    srd_text = aboleth.model_copy(update={"attribution": SRD_ATTRIBUTION})
    assert any(f.outcome is Outcome.REJECT for f in Validator().validate(srd_text).findings)


# --- the library file that shipped ---------------------------------------------------------------------------


def test_no_shipped_a5e_text_carries_markup_or_line_breaks() -> None:
    for monster in json.loads((DATA / "a5e-monsters.json").read_text(encoding="utf-8")):
        texts = [t["text"] for t in monster["traits"]] + [a.get("text") or a.get("effects_text") or "" for k in ("actions", "bonus_actions", "reactions") for a in monster.get(k, [])]
        texts += [o["text"] for o in (monster.get("legendary_actions") or {}).get("options", [])]
        assert not any("**" in t or "\n" in t or "_" in t for t in texts), monster["name"]


def test_the_shipped_a5e_file_is_complete_valid_and_credits_every_monster() -> None:
    shipped = [Monster.model_validate(m) for m in json.loads((DATA / "a5e-monsters.json").read_text(encoding="utf-8"))]
    assert len(shipped) == len(RAW) >= 580
    assert all(m.source is Source.A5E and m.attribution == A5E_ATTRIBUTION and m.id.startswith("a5e-") and not m.description for m in shipped)


def test_names_and_ids_are_unique_across_every_library_file() -> None:
    everyone = [m for f in ("sample-monsters.json", "srd-monsters.json", "a5e-monsters.json") for m in json.loads((DATA / f).read_text(encoding="utf-8"))]
    assert len({m["id"] for m in everyone}) == len(everyone)
    assert len({m["name"].lower() for m in everyone}) == len(everyone)


@pytest.mark.parametrize("name", ["Aboleth (A5E)"])
def test_a_renamed_monster_is_in_the_shipped_file(name: str) -> None:
    assert name in {m["name"] for m in json.loads((DATA / "a5e-monsters.json").read_text(encoding="utf-8"))}


# --- found by the second review: each of these was wrong in the first import --------------------------------

SHIPPED = {m["name"]: m for m in json.loads((DATA / "a5e-monsters.json").read_text(encoding="utf-8"))}


def shipped(name: str) -> dict:
    """A shipped monster by name, with or without the (A5E) suffix a clashing name gets."""
    return SHIPPED.get(name) or SHIPPED[f"{name} (A5E)"]


def sequence(name: str) -> list[tuple[str, int]]:
    multiattack = next(a for a in shipped(name)["actions"] if a["kind"] == "multiattack")
    return [(e["action"], e["count"]) for e in multiattack["sequence"]]


def test_a_plain_multiattack_sentence_is_typed_with_every_attack_it_names() -> None:
    assert sequence("Aboleth") == [("Tentacle", 3)]
    assert sequence("Barbed Devil") == [("Claws", 2), ("Tail", 1)]  # "two attacks with its claws and one with its tail"
    assert sequence("Cave Troll") == [("Bite", 1), ("Claw", 2)]
    assert sequence("Hezrou") == [("Bite", 1), ("Claws", 1)]


def test_a_multiattack_that_offers_a_choice_or_replaces_an_attack_stays_text() -> None:
    for sentence in (
        "The efreeti makes two brass sword attacks or hurls flame twice.",
        "The werebear makes two claw attacks  two greataxe attacks  or two handaxe attacks.",
        "The weretiger makes two attacks  neither of which can be a bite.",
        "The wereboar makes two attacks  only one of which can be with its tusks.",
        "The roc attacks once with its beak and once with its talons  or makes a beak attack and drops a grappled creature.",
    ):
        assert a5e._multiattack_sequence(sentence, [{"name": n} for n in ("Brass Sword", "Beak", "Talons", "Tusks", "Claw", "Bite")]) == []


def test_the_legendary_intro_gives_the_count_and_is_not_an_option() -> None:
    legendary = [m for m in SHIPPED.values() if m.get("legendary_actions")]
    assert legendary and not any("legendary action" in o["name"].lower() for m in legendary for o in m["legendary_actions"]["options"])
    assert shipped("Vampire")["legendary_actions"]["per_round"] == 1 and shipped("Aboleth")["legendary_actions"]["per_round"] == 2
    names = [o["name"] for m in legendary for o in m["legendary_actions"]["options"]]
    assert "Raging Storm (1/Day)" in names  # a per-day limit stays on a legendary option


def test_hit_dice_are_the_creatures_own_and_a_physical_resistance_names_only_its_types() -> None:
    assert shipped("Bugbear")["hit_points"]["dice"] == "5d8 + 8"
    gargoyle = shipped("Drainpipe Gargoyle")
    assert gargoyle["resistances"] == ["piercing", "slashing"] and gargoyle["damage_text"]["resistances"] == "piercing and slashing from nonmagical attacks"


def test_stat_block_debris_and_run_together_names_are_cleaned() -> None:
    traits = [t["name"] for m in SHIPPED.values() for t in m["traits"]]
    assert not any(n[0].isdigit() or "Weapon Attack" in n or (": " in n and len(n) > 30) for n in traits)
    assert "Healing" in [a["name"] for a in shipped("Unicorn")["actions"]]  # the first words of its text had been glued to the name
    assert "Curse: Mummy Rot" in [t["name"] for t in shipped("Mummy")["traits"]]  # a real name with a colon is kept
    assert a5e.clean("On a failure  it takes 5 damage.") == "On a failure, it takes 5 damage."
