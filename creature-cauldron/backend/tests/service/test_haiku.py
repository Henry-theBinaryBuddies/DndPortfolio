"""The Haiku generator, tested against a fake Anthropic client: no network, no key, no cost.

What these tests pin down is the request we would send (the model, the tool, no sampling settings, no prefill) and what
happens to every kind of reply, including the bad ones.
"""

import random
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from cauldron.options import Source
from cauldron.service.brief import build_brief
from cauldron.service.generators import BadOutput, GeneratorUnavailable
from cauldron.service.haiku import HaikuGenerator, build_generator
from cauldron.service.models import GenerateRequest
from cauldron.service.prompts import RenameContext
from cauldron.service.generators import MonsterGenerator
from cauldron.service.settings import Settings

SETTINGS = Settings.from_env({"CAULDRON_DATABASE": ":memory:"})
BRIEF = build_brief(GenerateRequest.model_validate({"types": ["dragon"], "crMin": 4, "crMax": 4}), "17", random.Random(1))


class FakeClient:
    """Stands in for anthropic.Anthropic: records every request and replies with what the test gave it."""

    def __init__(self, reply=None, error: Exception | None = None) -> None:
        self.requests: list[dict] = []
        self._reply = reply
        self._error = error
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._reply


def reply(tool: str, data: dict, stop_reason: str = "tool_use", tokens=(1200, 900)):
    block = SimpleNamespace(type="tool_use", name=tool, input=data, id="toolu_1")
    return SimpleNamespace(stop_reason=stop_reason, content=[block], usage=SimpleNamespace(input_tokens=tokens[0], output_tokens=tokens[1]))


def draft_data(sample) -> dict:
    data = sample("Stormhide Drake").model_dump(mode="json", exclude_none=True)
    for key in ("id", "schema_version", "source", "validated", "parent_id", "generator", "attribution", "features", "challenge", "damage_text"):
        data.pop(key, None)
    data["cr"] = "4"
    return data


def generator(client) -> HaikuGenerator:
    return HaikuGenerator(SETTINGS, client=client)


# --- generating -----------------------------------------------------------------------------------------


def test_a_good_reply_becomes_a_monster_with_token_counts(sample) -> None:
    client = FakeClient(reply("submit_monster", draft_data(sample)))
    result = generator(client).generate(BRIEF, [])
    assert result.monster.name == "Stormhide Drake" and result.monster.source is Source.AI
    assert result.monster.challenge.cr == "4"
    assert result.generator == "claude-haiku-5-5"
    assert (result.input_tokens, result.output_tokens) == (1200, 900)


def test_the_request_sent_to_the_model_is_exactly_what_we_intend(sample) -> None:
    client = FakeClient(reply("submit_monster", draft_data(sample)))
    generator(client).generate(BRIEF, ["Claimed CR 3, but the numbers look like CR 8."])
    (request,) = client.requests
    assert request["model"] == "claude-haiku-5-5"
    assert request["max_tokens"] == SETTINGS.max_output_tokens
    assert request["tool_choice"] == {"type": "tool", "name": "submit_monster"}
    assert [t["name"] for t in request["tools"]] == ["submit_monster"]
    assert request["tools"][0]["input_schema"]["properties"]["name"]
    assert "CR 4" in request["messages"][0]["content"] and "Claimed CR 3" in request["messages"][0]["content"]
    assert request["messages"][-1]["role"] == "user"  # no prefill: Haiku 5.5 refuses a trailing assistant turn
    assert isinstance(request["system"], str)


def test_no_sampling_settings_or_thinking_are_sent(sample) -> None:
    client = FakeClient(reply("submit_monster", draft_data(sample)))
    generator(client).generate(BRIEF, [])
    sent = set(client.requests[0])
    assert not sent & {"temperature", "top_p", "top_k", "thinking", "budget_tokens", "fallbacks", "betas"}


def test_a_reply_that_is_cut_off_is_bad_output(sample) -> None:
    client = FakeClient(reply("submit_monster", {"name": "Half"}, stop_reason="max_tokens"))
    with pytest.raises(BadOutput) as error:
        generator(client).generate(BRIEF, [])
    assert "cut off" in str(error.value)


def test_a_refusal_is_bad_output_not_a_crash() -> None:
    declined = SimpleNamespace(stop_reason="refusal", content=[], usage=SimpleNamespace(input_tokens=10, output_tokens=0))
    with pytest.raises(BadOutput) as error:
        generator(FakeClient(declined)).generate(BRIEF, [])
    assert "declined" in str(error.value)


def test_a_reply_without_the_tool_call_is_bad_output() -> None:
    text_only = SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Here is a monster...")], usage=SimpleNamespace(input_tokens=5, output_tokens=5))
    with pytest.raises(BadOutput) as error:
        generator(FakeClient(text_only)).generate(BRIEF, [])
    assert "did not submit" in str(error.value)


def test_a_reply_that_breaks_the_schema_is_bad_output_with_the_reasons(sample) -> None:
    data = draft_data(sample)
    data["cr"] = "4.5"
    data["size"] = "colossal"
    with pytest.raises(BadOutput) as error:
        generator(FakeClient(reply("submit_monster", data))).generate(BRIEF, [])
    message = str(error.value)
    assert "cr" in message and "size" in message


def test_the_reasons_are_short_enough_to_send_back(sample) -> None:
    data = draft_data(sample)
    data["actions"] = [{"kind": "dance"}] * 50
    with pytest.raises(BadOutput) as error:
        generator(FakeClient(reply("submit_monster", data))).generate(BRIEF, [])
    assert len(str(error.value)) < 800


def test_a_field_the_ai_must_not_set_is_refused(sample) -> None:
    data = draft_data(sample)
    data["source"] = "srd"
    with pytest.raises(BadOutput):
        generator(FakeClient(reply("submit_monster", data))).generate(BRIEF, [])


# --- failures of the service itself ---------------------------------------------------------------------


def a_request() -> httpx2.Request:
    return httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


@pytest.mark.parametrize(
    "error",
    [
        anthropic.APIConnectionError(request=a_request()),
        anthropic.APITimeoutError(request=a_request()),
    ],
)
def test_network_trouble_means_unavailable(error, sample) -> None:
    with pytest.raises(GeneratorUnavailable):
        generator(FakeClient(error=error)).generate(BRIEF, [])


def test_any_other_api_error_also_means_unavailable_and_never_leaks_details() -> None:
    class Odd(anthropic.APIError):
        pass

    error = Odd("secret details sk-ant-abc123", request=a_request(), body=None)
    with pytest.raises(GeneratorUnavailable) as raised:
        generator(FakeClient(error=error)).generate(BRIEF, [])
    assert "sk-ant" not in str(raised.value)


# --- renaming -------------------------------------------------------------------------------------------


def context() -> RenameContext:
    return RenameContext("Goblin", "A small raider.", "humanoid", "small", "1/4", ("its fire damage became cold damage",))


def test_a_good_name_reply_becomes_a_name_and_description() -> None:
    client = FakeClient(reply("submit_name", {"name": "Rimeback Raider", "description": "A frost-rimed raider."}, tokens=(300, 60)))
    result = generator(client).rename(context(), [])
    assert (result.name, result.description) == ("Rimeback Raider", "A frost-rimed raider.")
    assert (result.input_tokens, result.output_tokens) == (300, 60)
    request = client.requests[0]
    assert request["tool_choice"] == {"type": "tool", "name": "submit_name"}
    assert "Goblin" in request["messages"][0]["content"]


def test_the_name_tool_only_asks_for_a_name_and_a_description() -> None:
    client = FakeClient(reply("submit_name", {"name": "X", "description": "Y"}))
    generator(client).rename(context(), [])
    schema = client.requests[0]["tools"][0]["input_schema"]
    assert set(schema["properties"]) == {"name", "description"}


def test_a_bad_name_reply_is_bad_output() -> None:
    for data in ({"name": "", "description": "x"}, {"name": "x"}, {"name": "x", "description": "d" * 3000}, {"name": "x", "description": "d", "numbers": 5}):
        with pytest.raises(BadOutput):
            generator(FakeClient(reply("submit_name", data))).rename(context(), [])


# --- choosing the generator at start-up -----------------------------------------------------------------


def test_with_a_key_the_real_generator_is_used() -> None:
    chosen = build_generator(SETTINGS, {"ANTHROPIC_API_KEY": "sk-ant-test"})
    assert isinstance(chosen, HaikuGenerator)


def test_without_a_key_generation_is_unavailable_but_the_server_still_starts() -> None:
    chosen = build_generator(SETTINGS, {})
    assert isinstance(chosen, MonsterGenerator) and not isinstance(chosen, HaikuGenerator)
    with pytest.raises(GeneratorUnavailable):
        chosen.generate(BRIEF, [])
    with pytest.raises(GeneratorUnavailable):
        chosen.rename(context(), [])


def test_a_blank_key_counts_as_no_key() -> None:
    assert not isinstance(build_generator(SETTINGS, {"ANTHROPIC_API_KEY": "   "}), HaikuGenerator)


def remix_context() -> RenameContext:
    return RenameContext("Goblin", "A small raider.", "humanoid", "small", "1/4", ("Main damage: slashing to cold",), "cold", "ranged lob", "a thrown blast")


def test_a_remix_asks_for_a_move_name_and_returns_it() -> None:
    client = FakeClient(reply("submit_name", {"name": "Rimeback Raider", "description": "Frosted.", "move_name": "Ice Toss"}))
    result = generator(client).rename(remix_context(), [])
    assert result.move_name == "Ice Toss"
    assert set(client.requests[0]["tools"][0]["input_schema"]["properties"]) == {"name", "description", "move_name"}


def test_a_remix_reply_without_a_move_name_is_bad_output() -> None:
    with pytest.raises(BadOutput):
        generator(FakeClient(reply("submit_name", {"name": "Rimeback Raider", "description": "Frosted."}))).rename(remix_context(), [])


def test_a_reflavor_asks_for_ability_renames_and_returns_them() -> None:
    reflavor = RenameContext("Wolf", "A grey hunter.", "beast", "medium", "1/4", (), reflavor=True, rename_candidates=("Bite",))
    data = {"name": "Rimefang", "description": "Frost-furred.", "renames": [{"old": "Bite", "new": "Rimefang Snap"}]}
    client = FakeClient(reply("submit_name", data))
    result = generator(client).rename(reflavor, [])
    assert result.renames == (("Bite", "Rimefang Snap"),)
    assert set(client.requests[0]["tools"][0]["input_schema"]["properties"]) == {"name", "description", "renames"}


def test_a_reflavor_reply_with_no_renames_is_still_good() -> None:
    reflavor = RenameContext("Wolf", "A grey hunter.", "beast", "medium", "1/4", (), reflavor=True)
    result = generator(FakeClient(reply("submit_name", {"name": "Rimefang", "description": "Frost-furred."}))).rename(reflavor, [])
    assert result.renames == ()


def test_a_polymorph_the_forge_chooses_returns_the_picks() -> None:
    graft = RenameContext("Wolf", "A grey hunter.", "beast", "medium", "1/4", (), donor_name="Giant Eagle", donor_description="A big bird.", graft_options=(("speed:fly", "Fly 80 ft."),))
    client = FakeClient(reply("submit_name", {"name": "Skywolf", "description": "A winged hunter.", "picks": ["speed:fly"]}))
    result = generator(client).rename(graft, [])
    assert result.picks == ("speed:fly",)
    assert set(client.requests[0]["tools"][0]["input_schema"]["properties"]) == {"name", "description", "picks"}
