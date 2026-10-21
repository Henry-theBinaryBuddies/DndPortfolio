"""The real generator: Claude Haiku through the Anthropic SDK.

How a request works:

1. The prompt is built from fixed values (see ``prompts.py``) and sent as one user message.
2. The model must answer by calling a *tool*. A tool is a function the model can "call" by returning structured JSON
   that matches a schema; here the schema is our ``MonsterDraft`` (or ``NameDraft``), so the reply is data, not prose.
   ``tool_choice`` forces that call, so there is nothing else for the model to say.
3. The JSON is checked against the Pydantic model. Anything wrong becomes ``BadOutput`` with a short reason, which the
   service sends back to the model on the next attempt.

What is deliberately NOT sent: temperature, top_p, top_k (Haiku 5.5 refuses non-default values), thinking settings, and
any assistant "prefill" (Haiku 5.5 refuses a final assistant turn). The API key is never stored here: the SDK reads it
from the ANTHROPIC_API_KEY environment variable, so it cannot end up in a log or an error message.
"""

import logging
import uuid
from collections.abc import Mapping, Sequence

import anthropic
from pydantic import ValidationError

from cauldron.service.brief import Brief
from cauldron.service.draft import MonsterDraft, ReflavorNameDraft, RemixNameDraft, draft_json_schema, monster_from_draft, name_draft_type
from cauldron.service.generators import BadOutput, GeneratedMonster, GeneratedName, GeneratorUnavailable, MonsterGenerator
from cauldron.service.prompts import TOOL_NAME, Prompt, RenameContext, generate_prompt, rename_prompt
from cauldron.service.settings import Settings

log = logging.getLogger("cauldron")

NAME_TOOL = "submit_name"
MAX_REASONS = 4
MAX_REASON_LENGTH = 160


def _tool(name: str, description: str, schema: dict) -> dict:
    return {"name": name, "description": description, "input_schema": schema}


def _reasons(error: ValidationError) -> str:
    """The first few things that were wrong, as short plain text the model can act on."""
    parts = []
    for item in error.errors()[:MAX_REASONS]:
        where = ".".join(str(part) for part in item["loc"]) or "the reply"
        parts.append(f"{where}: {item['msg']}"[:MAX_REASON_LENGTH])
    more = len(error.errors()) - MAX_REASONS
    return "The reply did not match the schema. " + "; ".join(parts) + (f"; and {more} more problems." if more > 0 else ".")


class HaikuGenerator(MonsterGenerator):
    def __init__(self, settings: Settings, client: anthropic.Anthropic | None = None) -> None:
        self._model = settings.model
        self._max_tokens = settings.max_output_tokens
        # The SDK retries connection errors and 429 / 5xx on its own (twice); the timeout keeps a stuck call from
        # holding a worker thread forever.
        self._client = client or anthropic.Anthropic(max_retries=2, timeout=90.0)

    # --- the two things the service can ask for ---------------------------------------------------------

    def generate(self, brief: Brief, feedback: Sequence[str]) -> GeneratedMonster:
        prompt = generate_prompt(brief, feedback)
        tool = _tool(TOOL_NAME, "Submit the finished monster.", draft_json_schema())
        response = self._call(prompt, tool)
        data = self._tool_input(response, TOOL_NAME)
        try:
            draft = MonsterDraft.model_validate(data)
            monster = monster_from_draft(draft, generator=self._model, new_id=f"gen-draft-{uuid.uuid4().hex[:6]}")
        except ValidationError as error:
            raise BadOutput(_reasons(error), response.usage.input_tokens, response.usage.output_tokens) from None
        return GeneratedMonster(monster, self._model, response.usage.input_tokens, response.usage.output_tokens)

    def rename(self, context: RenameContext, feedback: Sequence[str]) -> GeneratedName:
        prompt = rename_prompt(context, feedback)
        draft_type = name_draft_type(context.move_label is not None, context.reflavor)
        tool = _tool(NAME_TOOL, "Submit the new name and description.", draft_type.model_json_schema())
        response = self._call(prompt, tool)
        data = self._tool_input(response, NAME_TOOL)
        try:
            draft = draft_type.model_validate(data)
        except ValidationError as error:
            raise BadOutput(_reasons(error), response.usage.input_tokens, response.usage.output_tokens) from None
        move_name = draft.move_name if isinstance(draft, RemixNameDraft) else None
        renames = tuple((r.old, r.new) for r in draft.renames) if isinstance(draft, ReflavorNameDraft) else ()
        return GeneratedName(draft.name, draft.description, self._model, response.usage.input_tokens, response.usage.output_tokens, move_name, renames)

    # --- the shared parts -------------------------------------------------------------------------------

    def _call(self, prompt: Prompt, tool: dict):
        try:
            return self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=prompt.system,
                messages=[{"role": "user", "content": prompt.user}],
                tools=[tool],
                tool_choice={"type": "tool", "name": tool["name"]},
            )
        except anthropic.APIError as error:
            # Log the kind of failure for the operator; the visitor only ever sees a fixed, generic message.
            log.warning("Anthropic call failed: %s (request id %s)", type(error).__name__, getattr(error, "request_id", None))
            raise GeneratorUnavailable(type(error).__name__) from None

    @staticmethod
    def _tool_input(response, tool_name: str) -> dict:
        spent = (response.usage.input_tokens, response.usage.output_tokens)
        if response.stop_reason == "refusal":
            raise BadOutput("The model declined this request. Try a different design.", *spent)
        if response.stop_reason == "max_tokens":
            raise BadOutput("The reply was cut off before it finished. Make the monster simpler and shorter.", *spent)
        for block in response.content:
            if block.type == "tool_use" and block.name == tool_name:
                return block.input
        raise BadOutput(f"The model did not submit the monster: it must call the {tool_name} tool.", *spent)


class UnavailableGenerator(MonsterGenerator):
    available = False

    """Used when no API key is configured. The server still runs (the library, the cache and reskins already made all work);
    anything that needs the AI answers that the forge cannot be reached."""

    def generate(self, brief: Brief, feedback: Sequence[str]) -> GeneratedMonster:
        raise GeneratorUnavailable("No ANTHROPIC_API_KEY is set.")

    def rename(self, context: RenameContext, feedback: Sequence[str]) -> GeneratedName:
        raise GeneratorUnavailable("No ANTHROPIC_API_KEY is set.")


def build_generator(settings: Settings, env: Mapping[str, str]) -> MonsterGenerator:
    """The Haiku generator when a key is configured, otherwise one that says the forge is unavailable."""
    if env.get("ANTHROPIC_API_KEY", "").strip():
        return HaikuGenerator(settings)
    log.warning("ANTHROPIC_API_KEY is not set: new monsters cannot be generated until it is.")
    return UnavailableGenerator()
