"""The SQLite store: monsters, the daily usage counter and the reskin cache."""

import pytest

from cauldron.service.models import GenerateRequest
from cauldron.service.store import DuplicateMonster, MonsterStore


@pytest.fixture
def store():
    s = MonsterStore(":memory:")
    yield s
    s.close()


def req(**fields) -> GenerateRequest:
    return GenerateRequest.model_validate(fields)


def test_a_new_store_is_empty(store) -> None:
    assert store.count() == 0 and store.all() == [] and store.names() == frozenset()


def test_a_monster_can_be_added_and_read_back_exactly(store, sample) -> None:
    store.add(sample("Cinderkite"))
    assert store.count() == 1
    assert store.get(sample("Cinderkite").id) == sample("Cinderkite")
    assert store.get("no-such-id") is None


def test_a_duplicate_id_is_refused(store, sample) -> None:
    store.add(sample("Cinderkite"))
    with pytest.raises(DuplicateMonster):
        store.add(sample("Cinderkite"))


def test_a_duplicate_name_is_refused_ignoring_case_and_spaces(store, sample) -> None:
    store.add(sample("Cinderkite"))
    twin = sample("Cinderkite").model_copy(update={"id": "another-id", "name": "  CINDERKITE "})
    with pytest.raises(DuplicateMonster):
        store.add(twin)


def test_names_lists_what_is_stored(store, sample) -> None:
    store.add(sample("Cinderkite"))
    store.add(sample("Stormhide Drake"))
    assert store.names() == frozenset({"cinderkite", "stormhide drake"})


def test_all_returns_every_monster_oldest_first(store, sample) -> None:
    for name in ("Stormhide Drake", "Cinderkite", "Hollowvale Hexer"):
        store.add(sample(name))
    assert [m.name for m in store.all()] == ["Stormhide Drake", "Cinderkite", "Hollowvale Hexer"]


def test_find_returns_only_monsters_that_fit_and_are_not_excluded(store, samples) -> None:
    for m in samples:
        store.add(m)
    found = store.find(req(types=["dragon"]), exclude_ids=frozenset())
    assert found and all(m.type.value == "dragon" for m in found)
    excluded = store.find(req(types=["dragon"]), exclude_ids=frozenset({found[0].id}))
    assert found[0].id not in {m.id for m in excluded}
    assert len(excluded) == len(found) - 1


def test_find_applies_every_filter(store, samples) -> None:
    for m in samples:
        store.add(m)
    result = store.find(req(crMin=2, crMax=4, features=["flying"]), exclude_ids=frozenset())
    assert all(2 <= m.challenge.cr_value <= 4 and "flying" in [f.value for f in m.features] for m in result)


def test_find_respects_the_limit(store, samples) -> None:
    for m in samples:
        store.add(m)
    assert len(store.find(req(), exclude_ids=frozenset(), limit=3)) == 3


def test_queries_cannot_be_hijacked_by_odd_ids(store, sample) -> None:
    store.add(sample("Cinderkite"))
    assert store.get("x' OR '1'='1") is None
    assert store.find(req(), exclude_ids=frozenset({"x'); DROP TABLE monsters; --"}))
    assert store.count() == 1


# --- daily usage ----------------------------------------------------------------------------------------


def test_usage_starts_at_zero_and_adds_up_per_day(store) -> None:
    assert store.usage("2026-10-20").calls == 0
    store.record_usage("2026-10-20", calls=1, input_tokens=100, output_tokens=50)
    store.record_usage("2026-10-20", calls=2, input_tokens=10, output_tokens=5)
    store.record_usage("2026-10-21", calls=1)
    day = store.usage("2026-10-20")
    assert (day.calls, day.input_tokens, day.output_tokens) == (3, 110, 55)
    assert store.usage("2026-10-21").calls == 1


# --- reskin cache ---------------------------------------------------------------------------------------


def test_a_reskin_can_be_remembered_by_its_key(store, sample) -> None:
    store.add(sample("Cinderkite"))
    assert store.reskin("some-key") is None
    store.remember_reskin("some-key", sample("Cinderkite").id)
    assert store.reskin("some-key") == sample("Cinderkite")


def test_the_store_survives_being_reopened(tmp_path, sample) -> None:
    path = tmp_path / "cauldron.sqlite3"
    first = MonsterStore(path)
    first.add(sample("Cinderkite"))
    first.record_usage("2026-10-20", calls=4)
    first.close()
    second = MonsterStore(path)
    assert second.get(sample("Cinderkite").id) == sample("Cinderkite")
    assert second.usage("2026-10-20").calls == 4
    second.close()
