"""The request and response models. They use the same camelCase names as the web page's TypeScript."""

import pytest
from pydantic import ValidationError

from cauldron.options import CreatureType, DamageType
from cauldron.service.models import FailureReason, GenerateFailure, GenerateRequest, GenerateSuccess, ReskinRequest


def request(**fields) -> GenerateRequest:
    return GenerateRequest.model_validate(fields)


def test_an_empty_request_is_valid_and_means_anything() -> None:
    r = request()
    assert r.cr_min is None and r.cr_max is None
    assert r.types == [] and r.exclude_ids == []


def test_the_camel_case_names_from_the_web_page_are_read() -> None:
    r = request(crMin=3, crMax=4, types=["undead"], damageThemes=["fire"], environments=["swamp"], excludeIds=["a"])
    assert (r.cr_min, r.cr_max) == (3, 4)
    assert r.types == [CreatureType.UNDEAD]
    assert r.exclude_ids == ["a"]


def test_the_python_names_work_too() -> None:
    assert request(cr_min=1, cr_max=2).cr_max == 2


def test_the_cr_bounds_must_be_real_challenge_ratings() -> None:
    for bad in (0.3, 31, -1, 2.5):
        with pytest.raises(ValidationError):
            request(crMax=bad)
    assert request(crMin=0.125, crMax=0.5).cr_min == 0.125


def test_the_minimum_cannot_be_above_the_maximum() -> None:
    with pytest.raises(ValidationError):
        request(crMin=5, crMax=2)


@pytest.mark.parametrize("field", ["types", "sizes", "environments", "roles", "damageThemes", "features"])
def test_each_list_only_accepts_values_from_its_fixed_list(field: str) -> None:
    with pytest.raises(ValidationError):
        request(**{field: ["a prompt injection attempt"]})


def test_repeats_in_a_list_are_removed_not_refused() -> None:
    assert request(types=["undead", "undead"]).types == [CreatureType.UNDEAD]


def test_unknown_fields_are_refused_so_no_free_text_can_ride_along() -> None:
    with pytest.raises(ValidationError):
        request(prompt="make it evil")


def test_the_exclude_list_is_bounded() -> None:
    with pytest.raises(ValidationError):
        request(excludeIds=[f"id-{i}" for i in range(501)])
    with pytest.raises(ValidationError):
        request(excludeIds=["x" * 101])


def test_requests_serialise_back_to_camel_case() -> None:
    assert "crMin" in request(crMin=1).model_dump(by_alias=True)


# --- reskin ---------------------------------------------------------------------------------------------


def test_a_reskin_request_names_a_base_and_at_least_one_change() -> None:
    r = ReskinRequest.model_validate({"baseId": "srd-goblin", "damageSwap": {"from": "fire", "to": "cold"}})
    assert r.base_id == "srd-goblin"
    assert r.damage_swap is not None and r.damage_swap.from_ is DamageType.FIRE and r.damage_swap.to is DamageType.COLD
    assert ReskinRequest.model_validate({"baseId": "a", "levelUp": True}).level_up is True
    remix = ReskinRequest.model_validate({"baseId": "a", "theme": "cold", "move": "burst"})
    assert (remix.theme, remix.move, remix.level_up) == ("cold", "burst", False)


def test_a_reskin_with_no_change_is_refused() -> None:
    with pytest.raises(ValidationError):
        ReskinRequest.model_validate({"baseId": "srd-goblin"})


def test_a_swap_to_the_same_type_is_refused() -> None:
    with pytest.raises(ValidationError):
        ReskinRequest.model_validate({"baseId": "a", "damageSwap": {"from": "fire", "to": "fire"}})


def test_an_unknown_theme_or_move_is_refused() -> None:
    for bad in ({"theme": "slashing"}, {"move": "teleport_everyone"}, {"template": "swarm"}):
        with pytest.raises(ValidationError):
            ReskinRequest.model_validate({"baseId": "a", **bad})


def test_surprise_is_allowed_for_a_theme_and_for_a_move() -> None:
    r = ReskinRequest.model_validate({"baseId": "a", "theme": "surprise", "move": "surprise"})
    assert r.has_surprise
    assert not ReskinRequest.model_validate({"baseId": "a", "theme": "fire"}).has_surprise


def test_a_damage_swap_cannot_be_mixed_with_a_theme_or_move() -> None:
    swap = {"from": "fire", "to": "cold"}
    for extra in ({"theme": "acid"}, {"move": "lob"}):
        with pytest.raises(ValidationError):
            ReskinRequest.model_validate({"baseId": "a", "damageSwap": swap, **extra})
    assert ReskinRequest.model_validate({"baseId": "a", "damageSwap": swap, "levelUp": True}).level_up


def test_a_reskin_cannot_carry_a_monster_only_an_id() -> None:
    with pytest.raises(ValidationError):
        ReskinRequest.model_validate({"baseId": "a", "levelUp": True, "base": {"name": "evil text"}})


def test_a_reskin_has_a_stable_cache_key() -> None:
    one = ReskinRequest.model_validate({"baseId": "a", "damageSwap": {"from": "fire", "to": "cold"}, "levelUp": True})
    two = ReskinRequest.model_validate({"baseId": "a", "damageSwap": {"from": "fire", "to": "cold"}, "levelUp": True})
    other = ReskinRequest.model_validate({"baseId": "a", "levelUp": True})
    assert one.cache_key == two.cache_key != other.cache_key


def test_the_cache_key_tells_themes_moves_and_level_up_apart() -> None:
    keys = {
        ReskinRequest.model_validate({"baseId": "a", **extra}).cache_key
        for extra in ({"theme": "cold"}, {"theme": "fire"}, {"move": "lob"}, {"theme": "cold", "move": "lob"}, {"theme": "cold", "levelUp": True})
    }
    assert len(keys) == 5


# --- responses ------------------------------------------------------------------------------------------


def test_failures_use_the_reasons_the_web_page_knows() -> None:
    assert {r.value for r in FailureReason} == {"offline", "resting", "rate-limited", "invalid", "error"}
    failure = GenerateFailure(reason=FailureReason.RESTING, message="The forge is resting, back tomorrow.")
    assert failure.model_dump(mode="json") == {"ok": False, "reason": "resting", "message": "The forge is resting, back tomorrow."}


def test_a_success_carries_the_monster_without_empty_fields(sample) -> None:
    success = GenerateSuccess(monster=sample("Cinderkite"), notes=["Fixed a number."])
    dumped = success.model_dump(mode="json", exclude_none=True)
    assert dumped["ok"] is True and dumped["notes"] == ["Fixed a number."]
    assert dumped["monster"]["name"] == "Cinderkite"
    assert "parent_id" not in dumped["monster"]
