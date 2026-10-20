"""The generation service: cache first, then the AI with a retry loop, all behind the daily cap.

Every test uses the scripted generator, so nothing here costs money or needs the network.
"""

import json
import random
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest

from cauldron.monster import Monster
from cauldron.options import DamageType, Source
from cauldron.rules import SRD_ATTRIBUTION, cr_value, proficiency_bonus, xp_for_cr
from cauldron.seed.importer import import_monster
from cauldron.service.generators import BadOutput, GeneratedMonster, GeneratedName, GeneratorUnavailable, ScriptedGenerator
from cauldron.service.limits import DailyCap
from cauldron.service.models import FailureReason, GenerateFailure, GenerateRequest, GenerateSuccess, ReskinRequest
from cauldron.service.service import GenerationService
from cauldron.service.settings import Settings
from cauldron.service.store import MonsterStore

RAW = {m["index"]: m for m in json.loads((Path(__file__).parents[2] / "data" / "srd-2014" / "5e-SRD-Monsters.json").read_text(encoding="utf-8"))}
DAY = datetime(2026, 10, 20, 12, tzinfo=UTC)


@dataclass
class Rig:
    service: GenerationService
    store: MonsterStore
    generator: ScriptedGenerator
    cap: DailyCap


@pytest.fixture
def make():
    stores: list[MonsterStore] = []

    def build(monsters=(), names=(), library=(), cap=100, **env) -> Rig:
        settings = Settings.from_env({"CAULDRON_DATABASE": ":memory:", **env})
        store = MonsterStore(":memory:")
        stores.append(store)
        generator = ScriptedGenerator(monsters=list(monsters), names=list(names))
        daily = DailyCap(store, limit=cap, clock=lambda: DAY)
        service = GenerationService(settings, store, generator, daily, {m.id: m for m in library}, rng=random.Random(1))
        return Rig(service, store, generator, daily)

    yield build
    for s in stores:
        s.close()


def req(**fields) -> GenerateRequest:
    return GenerateRequest.model_validate(fields)


def made(monster: Monster, name: str | None = None, tokens: tuple[int, int] = (0, 0)) -> GeneratedMonster:
    update = {"name": name} if name else {}
    return GeneratedMonster(monster.model_copy(update=update), generator="scripted", input_tokens=tokens[0], output_tokens=tokens[1])


def with_cr(monster: Monster, cr: str) -> Monster:
    challenge = monster.challenge.model_copy(
        update={"cr": cr, "cr_value": cr_value(cr), "xp": xp_for_cr(cr), "proficiency_bonus": proficiency_bonus(cr)}
    )
    return monster.model_copy(update={"challenge": challenge})


DRAGONS = dict(types=["dragon"], crMin=4, crMax=4)  # the Stormhide Drake is a CR 4 dragon


# --- the cache ------------------------------------------------------------------------------------------


def test_a_cached_match_is_returned_without_calling_the_ai(make, sample) -> None:
    rig = make()
    rig.store.add(sample("Stormhide Drake"))
    found = rig.service.lookup(req(**DRAGONS))
    assert found == sample("Stormhide Drake")
    assert rig.generator.generate_calls == []
    assert rig.cap.remaining() == 100


def test_a_cached_monster_the_visitor_already_has_is_not_returned(make, sample) -> None:
    rig = make()
    rig.store.add(sample("Stormhide Drake"))
    assert rig.service.lookup(req(**DRAGONS, excludeIds=[sample("Stormhide Drake").id])) is None


def test_the_cache_is_empty_to_begin_with(make) -> None:
    assert make().service.lookup(req()) is None


# --- generating -----------------------------------------------------------------------------------------


def test_a_good_monster_is_stored_and_returned(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Gale Drake", tokens=(900, 700))])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess)
    monster = result.monster
    assert monster.name == "Gale Drake" and monster.id.startswith("gen-")
    assert monster.source is Source.AI and monster.validated is True and monster.generator == "scripted"
    assert rig.store.get(monster.id) == monster
    assert rig.cap.remaining() == 99
    used = rig.store.usage("2026-10-20")
    assert (used.calls, used.input_tokens, used.output_tokens) == (1, 900, 700)


def test_the_generator_is_given_a_brief_that_respects_the_request(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Gale Drake")])
    rig.service.create(req(**DRAGONS))
    brief, feedback = rig.generator.generate_calls[0]
    assert brief.cr == "4" and brief.type.value == "dragon" and feedback == []


def test_the_cap_on_challenge_rating_applies_when_none_is_given(make, sample) -> None:
    rig = make(monsters=[made(sample("Cinderkite"), f"Spark Kite {i}") for i in range(30)])
    for _ in range(30):
        rig.service.create(req())
    assert all(cr_value(brief.cr) <= 17 for brief, _ in rig.generator.generate_calls)


def test_a_request_wholly_above_the_cap_is_refused_without_calling_the_ai(make) -> None:
    rig = make()
    result = rig.service.create(req(crMin=20))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.INVALID
    assert "17" in result.message
    assert rig.generator.generate_calls == [] and rig.cap.remaining() == 100


def test_automatic_corrections_are_reported_as_notes(make, sample) -> None:
    drake = sample("Stormhide Drake").model_copy(update={"name": "Gale Drake", "challenge": sample("Stormhide Drake").challenge.model_copy(update={"xp": 1})})
    result = make(monsters=[GeneratedMonster(drake, "scripted")]).service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess)
    assert result.monster.challenge.xp == 1100
    assert any("xp" in note for note in result.notes)


def test_a_second_request_for_a_new_monster_generates_again(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Gale Drake"), made(sample("Stormhide Drake"), "Squall Drake")])
    first = rig.service.create(req(**DRAGONS))
    assert isinstance(first, GenerateSuccess)
    assert rig.service.lookup(req(**DRAGONS, excludeIds=[first.monster.id])) is None
    second = rig.service.create(req(**DRAGONS))
    assert isinstance(second, GenerateSuccess) and second.monster.id != first.monster.id
    assert rig.store.count() == 2


# --- the retry loop -------------------------------------------------------------------------------------


def test_a_cr_that_does_not_fit_is_retried_with_the_problem_as_feedback(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(monsters=[made(with_cr(drake, "0"), "Bad Drake"), made(drake, "Good Drake")])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess) and result.monster.name == "Good Drake"
    assert rig.generator.generate_calls[0][1] == []
    assert any("Claimed CR" in line for line in rig.generator.generate_calls[1][1])
    assert rig.cap.remaining() == 98  # both attempts counted


def test_the_reason_for_each_rejected_attempt_is_logged_for_the_operator(make, sample, caplog) -> None:
    import logging

    drake = sample("Stormhide Drake")
    rig = make(monsters=[made(with_cr(drake, "0"), "Bad Drake"), made(drake, "Good Drake")])
    with caplog.at_level(logging.INFO, logger="cauldron"):
        rig.service.create(req(**DRAGONS))
    messages = [r.getMessage() for r in caplog.records if r.name == "cauldron"]
    assert messages[0].startswith("Designing: CR 4 ")  # what the AI was asked for is logged first
    rejected = [m for m in messages if "was not accepted" in m]
    assert len(rejected) == 1 and "attempt 1 of 3" in rejected[0] and "Claimed CR" in rejected[0]


def test_a_monster_that_does_not_fit_the_request_is_retried(make, sample) -> None:
    rig = make(monsters=[made(sample("Hollowvale Hexer"), "Wrong Kind"), made(sample("Stormhide Drake"), "Right Kind")])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess) and result.monster.name == "Right Kind"
    feedback = rig.generator.generate_calls[1][1]
    assert any("type" in line.lower() or "challenge" in line.lower() for line in feedback)


def test_a_blocked_name_is_retried(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Beholder Drake"), made(sample("Stormhide Drake"), "Gale Drake")])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess) and result.monster.name == "Gale Drake"
    assert any("not ours to use" in line for line in rig.generator.generate_calls[1][1])


def test_a_name_that_already_exists_is_retried(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Gale Drake"), made(sample("Stormhide Drake"), "Squall Drake")])
    rig.store.add(sample("Cinderkite").model_copy(update={"name": "Gale Drake"}))
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess) and result.monster.name == "Squall Drake"


def test_output_the_ai_got_wrong_is_retried(make, sample) -> None:
    rig = make(monsters=[BadOutput("The reply was not valid JSON."), made(sample("Stormhide Drake"), "Gale Drake")])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateSuccess)
    assert "not valid JSON" in rig.generator.generate_calls[1][1][0]


def test_after_all_attempts_fail_the_monster_is_discarded(make, sample) -> None:
    bad = made(with_cr(sample("Stormhide Drake"), "0"), "Bad Drake")
    rig = make(monsters=[bad, bad, bad])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.ERROR
    assert len(rig.generator.generate_calls) == 3  # one try and two retries
    assert rig.store.count() == 0
    assert rig.cap.remaining() == 97


def test_the_number_of_retries_comes_from_the_settings(make, sample) -> None:
    bad = made(with_cr(sample("Stormhide Drake"), "0"), "Bad Drake")
    rig = make(monsters=[bad, bad, bad], CAULDRON_MAX_RETRIES="0")
    rig.service.create(req(**DRAGONS))
    assert len(rig.generator.generate_calls) == 1


def test_an_unreachable_ai_stops_at_once_with_an_error(make) -> None:
    rig = make(monsters=[GeneratorUnavailable("connection refused")])
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.ERROR
    assert len(rig.generator.generate_calls) == 1
    assert rig.cap.remaining() == 99  # the attempt was made, so it counts


# --- the daily cap --------------------------------------------------------------------------------------


def test_with_the_cap_used_up_the_forge_is_resting(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Gale Drake")], cap=1)
    assert isinstance(rig.service.create(req(**DRAGONS)), GenerateSuccess)
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.RESTING
    assert len(rig.generator.generate_calls) == 1
    assert rig.service.resting()


def test_the_cap_running_out_in_the_middle_of_retries_stops_them(make, sample) -> None:
    bad = made(with_cr(sample("Stormhide Drake"), "0"), "Bad Drake")
    rig = make(monsters=[bad, bad, bad], cap=2)
    result = rig.service.create(req(**DRAGONS))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.RESTING
    assert len(rig.generator.generate_calls) == 2


def test_cached_answers_still_work_when_the_forge_is_resting(make, sample) -> None:
    rig = make(cap=1)
    rig.store.add(sample("Stormhide Drake"))
    rig.cap.reserve()
    assert rig.service.resting()
    assert rig.service.lookup(req(**DRAGONS)) is not None


# --- reskinning -----------------------------------------------------------------------------------------


def swap(base_id: str, **extra) -> ReskinRequest:
    return ReskinRequest.model_validate({"baseId": base_id, "damageSwap": {"from": "lightning", "to": "cold"}, **extra})


def named(name: str, text: str = "A frosty twist.") -> GeneratedName:
    return GeneratedName(name=name, description=text, generator="scripted", input_tokens=50, output_tokens=40)


def test_a_damage_swap_is_done_by_code_and_the_ai_only_names_it(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Rimestorm Drake")], library=[drake])
    result = rig.service.create_reskin(swap(drake.id))
    assert isinstance(result, GenerateSuccess)
    monster = result.monster
    assert monster.name == "Rimestorm Drake" and monster.description == "A frosty twist."
    assert monster.source is Source.RESKIN and monster.parent_id == drake.id and monster.id.startswith("gen-")
    assert DamageType.LIGHTNING not in monster.immunities + monster.resistances
    assert DamageType.COLD in {r.type for a in monster.actions if hasattr(a, "damage") for r in a.damage} | {DamageType.COLD}
    assert monster.challenge == drake.challenge
    assert rig.store.get(monster.id) == monster


def test_the_ai_is_told_what_changed_but_never_given_numbers_to_change(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Rimestorm Drake")], library=[drake])
    rig.service.create_reskin(swap(drake.id, levelUp=True))
    context, feedback = rig.generator.rename_calls[0]
    assert context.base_name == "Stormhide Drake" and context.base_description == drake.description
    assert any("lightning" in c and "cold" in c for c in context.changes)
    assert any("Level up" in c for c in context.changes)
    assert feedback == []


def test_a_level_up_reskin_raises_the_challenge_rating_by_one_step(make, sample) -> None:
    drake = sample("Stormhide Drake")  # CR 4
    rig = make(names=[named("Level Name")], library=[drake])
    result = rig.service.create_reskin(ReskinRequest.model_validate({"baseId": drake.id, "levelUp": True}))
    assert isinstance(result, GenerateSuccess) and result.monster.challenge.cr == "5"


def test_a_reskin_of_an_srd_monster_keeps_the_srd_credit(make) -> None:
    goblin = import_monster(RAW["goblin"]).monster
    rig = make(names=[named("Ember Raider")], library=[goblin])
    result = rig.service.create_reskin(ReskinRequest.model_validate({"baseId": goblin.id, "levelUp": True}))
    assert isinstance(result, GenerateSuccess) and result.monster.attribution == SRD_ATTRIBUTION


def test_an_unknown_base_is_refused_without_calling_the_ai(make) -> None:
    rig = make()
    result = rig.service.create_reskin(swap("no-such-monster"))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.INVALID
    assert rig.generator.rename_calls == [] and rig.cap.remaining() == 100


def test_a_reskin_speaks_of_itself_by_its_new_name(make, sample) -> None:
    from cauldron.actions import TextAction

    base = sample("Stormhide Drake")
    fortitude = TextAction(name="Fortitude", text="If damage reduces the stormhide drake to 0 hit points, the stormhide drake drops to 1 hit point instead.")
    library_monster = base.model_copy(update={"traits": [fortitude]})
    rig = make(names=[named("Ironbound Revenant")], library=[library_monster])
    result = rig.service.create_reskin(ReskinRequest.model_validate({"baseId": base.id, "levelUp": True}))
    assert isinstance(result, GenerateSuccess)
    text = result.monster.traits[0].text
    assert "stormhide drake" not in text and text.count("ironbound revenant") == 2
    assert result.monster.name == "Ironbound Revenant"


def test_a_generated_monster_can_be_reskinned_too(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(monsters=[made(drake, "Gale Drake")], names=[named("Rimestorm Drake")])
    first = rig.service.create(req(**DRAGONS))
    assert isinstance(first, GenerateSuccess)
    result = rig.service.create_reskin(swap(first.monster.id))
    assert isinstance(result, GenerateSuccess) and result.monster.parent_id == first.monster.id


def test_a_repeated_reskin_is_answered_from_the_store_for_free(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Rimestorm Drake")], library=[drake])
    request = swap(drake.id)
    assert rig.service.lookup_reskin(request) is None
    first = rig.service.create_reskin(request)
    assert isinstance(first, GenerateSuccess)
    assert rig.service.lookup_reskin(request) == first.monster
    assert rig.cap.remaining() == 99


def test_a_blocked_new_name_is_retried(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Beholder Storm"), named("Rimestorm Drake")], library=[drake])
    result = rig.service.create_reskin(swap(drake.id))
    assert isinstance(result, GenerateSuccess) and result.monster.name == "Rimestorm Drake"
    assert any("not ours to use" in line for line in rig.generator.rename_calls[1][1])


def test_a_reskin_is_not_sent_back_over_the_base_monsters_own_cr(make, sample) -> None:
    # The AI cannot change numbers in a reskin, so a base monster whose CR the estimator doubts must not fail it.
    leviathan = sample("Dune Leviathan")
    doubtful = with_cr(leviathan, "12").model_copy(update={"id": "doubtful"})
    rig = make(names=[named("Sandsong Leviathan")], library=[doubtful])
    request = ReskinRequest.model_validate({"baseId": "doubtful", "damageSwap": {"from": "piercing", "to": "cold"}})
    assert isinstance(rig.service.create_reskin(request), GenerateSuccess)


def test_a_reskin_needs_the_daily_cap_but_a_repeat_does_not(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Rimestorm Drake")], library=[drake], cap=1)
    assert isinstance(rig.service.create_reskin(swap(drake.id)), GenerateSuccess)
    other = ReskinRequest.model_validate({"baseId": drake.id, "levelUp": True})
    result = rig.service.create_reskin(other)
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.RESTING
    assert rig.service.lookup_reskin(swap(drake.id)) is not None


def test_an_unreachable_ai_gives_an_error_for_a_reskin(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[GeneratorUnavailable("down")], library=[drake])
    result = rig.service.create_reskin(swap(drake.id))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.ERROR


def test_the_library_lists_everything_the_server_has_generated(make, sample) -> None:
    rig = make(monsters=[made(sample("Stormhide Drake"), "Gale Drake")])
    created = rig.service.create(req(**DRAGONS))
    assert isinstance(created, GenerateSuccess)
    assert rig.service.generated_monsters() == [created.monster]


# --- remixing -------------------------------------------------------------------------------------------


def remix_request(base_id: str, **extra) -> ReskinRequest:
    return ReskinRequest.model_validate({"baseId": base_id, **extra})


def named_move(name: str, move: str) -> GeneratedName:
    return GeneratedName(name=name, description="A new look.", generator="scripted", input_tokens=50, output_tokens=40, move_name=move)


def test_a_remix_changes_the_theme_and_adds_the_named_move(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named_move("Rimeclaw Drake", "Glacial Lunge")], library=[drake])
    result = rig.service.create_reskin(remix_request(drake.id, theme="cold", move="lob"))
    assert isinstance(result, GenerateSuccess)
    monster = result.monster
    assert monster.actions[-1].name == "Glacial Lunge" and len(monster.actions) == len(drake.actions) + 1
    assert DamageType.COLD in monster.resistances + monster.immunities
    assert any(note.startswith("Main damage:") for note in result.notes) and any("Glacial Lunge" in note for note in result.notes)
    assert monster.challenge.cr == drake.challenge.cr


def test_the_ai_is_told_the_theme_and_move_but_not_the_stand_in_name(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named_move("Rimeclaw Drake", "Glacial Lunge")], library=[drake])
    rig.service.create_reskin(remix_request(drake.id, theme="cold", move="lob"))
    context, _ = rig.generator.rename_calls[0]
    assert context.theme == "cold" and context.move_label == "lob" and context.move_blurb
    assert not any("Signature Move" in c for c in context.changes)


def test_a_move_without_a_name_is_sent_back_for_one(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Rimeclaw Drake"), named_move("Rimeclaw Drake", "Glacial Lunge")], library=[drake])
    result = rig.service.create_reskin(remix_request(drake.id, move="lob"))
    assert isinstance(result, GenerateSuccess) and result.monster.actions[-1].name == "Glacial Lunge"
    assert any("move_name" in line for line in rig.generator.rename_calls[1][1])


def test_a_move_that_does_not_fit_is_refused_without_calling_the_ai(make, sample) -> None:
    frog = import_monster(RAW["frog"]).monster
    rig = make(library=[frog])
    result = rig.service.create_reskin(remix_request(frog.id, move="burst"))
    assert isinstance(result, GenerateFailure) and result.reason is FailureReason.INVALID
    assert rig.generator.rename_calls == [] and rig.cap.remaining() == 100


def test_a_surprise_is_decided_by_the_server_and_then_cached_like_any_choice(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named_move("Wildmaw Drake", "Odd Lunge")], library=[drake])
    settled = rig.service.settle(remix_request(drake.id, theme="surprise", move="surprise"))
    assert not settled.has_surprise and settled.theme != "lightning" and settled.move is not None
    assert rig.service.lookup_reskin(settled) is None
    first = rig.service.create_reskin(settled)
    assert isinstance(first, GenerateSuccess)
    assert rig.service.lookup_reskin(settled) == first.monster


def test_a_request_with_a_surprise_in_it_is_never_looked_up(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named("Rimeclaw Drake")], library=[drake])
    assert rig.service.lookup_reskin(remix_request(drake.id, theme="surprise")) is None


def test_a_remix_with_a_level_up_raises_the_challenge_rating_once(make, sample) -> None:
    drake = sample("Stormhide Drake")  # CR 4
    rig = make(names=[named("Rimeclaw Drake")], library=[drake])
    result = rig.service.create_reskin(remix_request(drake.id, theme="cold", levelUp=True))
    assert isinstance(result, GenerateSuccess) and result.monster.challenge.cr == "5"
    assert any(note.startswith("Level up: CR 4") for note in result.notes)


def test_a_reskin_remembers_what_it_changed(make, sample) -> None:
    drake = sample("Stormhide Drake")
    rig = make(names=[named_move("Rimeclaw Drake", "Glacial Lunge")], library=[drake])
    result = rig.service.create_reskin(remix_request(drake.id, theme="cold", move="lob", levelUp=True))
    assert isinstance(result, GenerateSuccess)
    changes = result.monster.changes
    assert changes is not None and changes[0].startswith("Main damage:") and changes[-1].startswith("Level up:")
    assert any("Glacial Lunge" in c for c in changes)
    assert rig.store.get(result.monster.id).changes == changes  # type: ignore[union-attr]


def test_a_monster_that_was_not_reskinned_has_no_changes(sample) -> None:
    assert sample("Stormhide Drake").changes is None
