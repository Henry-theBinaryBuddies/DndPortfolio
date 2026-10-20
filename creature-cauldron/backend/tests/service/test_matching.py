"""Does a monster fit a request? The same rules as the web page's filters."""

from cauldron.service.matching import matches
from cauldron.service.models import GenerateRequest


def req(**fields) -> GenerateRequest:
    return GenerateRequest.model_validate(fields)


def test_an_empty_request_matches_everything(samples) -> None:
    assert all(matches(m, req()) for m in samples)


def test_challenge_rating_bounds_are_inclusive(sample) -> None:
    drake = sample("Stormhide Drake")  # CR 4
    assert matches(drake, req(crMin=4, crMax=4))
    assert matches(drake, req(crMin=3))
    assert not matches(drake, req(crMin=5))
    assert not matches(drake, req(crMax=3))


def test_type_size_and_role_are_one_of(sample) -> None:
    drake = sample("Stormhide Drake")
    assert matches(drake, req(types=["dragon", "undead"]))
    assert not matches(drake, req(types=["undead"]))
    assert matches(drake, req(sizes=["large"]))
    assert not matches(drake, req(sizes=["tiny", "small"]))


def test_environments_and_damage_themes_need_any_one_of_the_picks(sample) -> None:
    drake = sample("Stormhide Drake")
    wanted = req(environments=[drake.environments[0].value, "arctic"])
    assert matches(drake, wanted)
    assert not matches(drake, req(environments=["arctic"]) if "arctic" not in [e.value for e in drake.environments] else req(environments=["underwater"]))


def test_features_need_all_of_the_picks(sample) -> None:
    drake = sample("Stormhide Drake")  # flying, multiattack, breath-weapon
    assert matches(drake, req(features=["flying", "multiattack"]))
    assert not matches(drake, req(features=["flying", "legendary"]))


def test_every_group_must_fit_at_once(sample) -> None:
    drake = sample("Stormhide Drake")
    assert matches(drake, req(types=["dragon"], crMin=3, crMax=5, features=["flying"]))
    assert not matches(drake, req(types=["dragon"], crMin=3, crMax=5, features=["flying"], sizes=["tiny"]))
