"""The generation service: the one place that decides what happens to a request.

Order of events, cheapest first:

1. ``lookup``: is there already a stored monster that fits and that the visitor does not have? Free.
2. ``create``: otherwise ask the AI. Every attempt takes one call from the daily cap *before* it is made. The monster
   the AI returns goes through the validator and a check that it really fits the request; if either complains, the complaints
   are sent back to the AI and it tries again, up to ``max_retries`` more times. A monster that never passes is thrown away.
3. ``lookup_reskin`` / ``create_reskin``: the same idea for reskins. Code changes the numbers (damage swap, elite template);
   the AI only writes a new name and description.

The rate limit per visitor is applied by the web layer (it needs the visitor's address); this class owns everything else.
"""

import logging
import random
import re
import uuid
from collections.abc import Mapping

from pydantic import ValidationError

from cauldron.monster import Monster
from cauldron.options import Source
from cauldron.service.brief import build_brief, effective_bounds
from cauldron.service.generators import BadOutput, GeneratorUnavailable, MonsterGenerator
from cauldron.service.limits import DailyCap
from cauldron.service.matching import mismatches
from cauldron.service.models import FailureReason, GenerateFailure, GenerateRequest, GenerateSuccess, ReskinRequest
from cauldron.service.prompts import RenameContext
from cauldron.service.settings import Settings
from cauldron.service.store import DuplicateMonster, MonsterStore
from cauldron.templates import get_template, swap_damage_type
from cauldron.validator import CrConsistencyCheck, Outcome, Status, ValidationContext, Validator, default_checks

Result = GenerateSuccess | GenerateFailure

_RESTING = "The forge is resting, back tomorrow. The library still works."
_COULD_NOT_REACH = "The forge could not be reached just now. Try again in a little while."
_GAVE_UP = "The forge could not make a monster that passed its checks. Try again, or try different filters."


log = logging.getLogger("cauldron")


def _log_failed_attempt(kind: str, attempt: int, attempts: int, problems: list[str]) -> None:
    """Why an attempt was rejected, for the operator. Visitors never see this; it shows how often and why retries happen."""
    log.info("%s attempt %d of %d was not accepted: %s", kind, attempt, attempts, " | ".join(problems)[:600])


def _failure(reason: FailureReason, message: str) -> GenerateFailure:
    return GenerateFailure(reason=reason, message=message)


def _new_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "monster"
    return f"gen-{slug}-{uuid.uuid4().hex[:6]}"


class GenerationService:
    def __init__(
        self,
        settings: Settings,
        store: MonsterStore,
        generator: MonsterGenerator,
        cap: DailyCap,
        library: Mapping[str, Monster],
        rng: random.Random | None = None,
    ) -> None:
        self._settings = settings
        self._store = store
        self._generator = generator
        self._cap = cap
        self._library = library  # the server's own static monsters (SRD and samples), by id
        self._rng = rng or random.Random()
        self._validator = Validator()
        # In a reskin the AI cannot change a single number, so a doubt about the base monster's CR is not its fault.
        self._reskin_validator = Validator(checks=[c for c in default_checks() if not isinstance(c, CrConsistencyCheck)])

    # --- state ------------------------------------------------------------------------------------------

    def resting(self) -> bool:
        """True when the daily cap is used up. Cached answers still work; new generation does not."""
        return self._cap.exhausted()

    def generated_monsters(self) -> list[Monster]:
        return self._store.all()

    # --- generating -------------------------------------------------------------------------------------

    def lookup(self, request: GenerateRequest) -> Monster | None:
        """A stored monster that fits the request and is new to the visitor, or None. Free: no AI, no cap."""
        found = self._store.find(request, frozenset(request.exclude_ids), limit=50)
        return self._rng.choice(found) if found else None

    def create(self, request: GenerateRequest) -> Result:
        bounds = effective_bounds(request, self._settings.max_cr)
        if bounds is None:
            return _failure(FailureReason.INVALID, f"Generating is limited to challenge rating {self._settings.max_cr} or below for now.")
        brief = build_brief(request, self._settings.max_cr, self._rng)
        log.info("Designing: %s", brief)
        wanted = request.model_copy(update={"cr_min": bounds[0], "cr_max": bounds[1]})

        feedback: list[str] = []
        attempts = 1 + self._settings.max_retries
        for attempt in range(1, attempts + 1):
            if not self._cap.reserve():
                return _failure(FailureReason.RESTING, _RESTING)
            try:
                generated = self._generator.generate(brief, feedback)
            except GeneratorUnavailable:
                return _failure(FailureReason.ERROR, _COULD_NOT_REACH)
            except BadOutput as problem:
                feedback = [str(problem)]
                _log_failed_attempt("generate", attempt, attempts, feedback)
                continue
            self._cap.record_tokens(generated.input_tokens, generated.output_tokens)

            outcome = self._accept(generated.monster, generated.generator, wanted)
            if isinstance(outcome, GenerateSuccess):
                return outcome
            feedback = outcome
            _log_failed_attempt("generate", attempt, attempts, feedback)
        return _failure(FailureReason.ERROR, _GAVE_UP)

    def _accept(self, monster: Monster, generator: str, wanted: GenerateRequest) -> GenerateSuccess | list[str]:
        """The validated, stored monster, or the list of problems to send back to the AI."""
        try:
            candidate = self._rebuild(monster, id=_new_id(monster.name), source=Source.AI, validated=False, generator=generator, parent_id=None)
        except ValidationError as problem:
            return [f"The monster was not complete: {problem.errors()[0]['msg']}."]
        report = self._validator.validate(candidate, ValidationContext(existing_names=self._store.names()))
        if report.status in (Status.REJECTED, Status.RETRY):
            return [f.message for f in report.findings if f.outcome in (Outcome.REJECT, Outcome.RETRY)]
        problems = mismatches(report.monster, wanted)
        if problems:
            return problems
        try:
            self._store.add(report.monster)
        except DuplicateMonster:
            return ["That name is already taken. Choose a different one."]
        return GenerateSuccess(monster=report.monster, notes=[f.message for f in report.corrections])

    # --- reskinning -------------------------------------------------------------------------------------

    def lookup_reskin(self, request: ReskinRequest) -> Monster | None:
        """A reskin made earlier for exactly this request. Free."""
        return self._store.reskin(request.cache_key)

    def create_reskin(self, request: ReskinRequest) -> Result:
        base = self._library.get(request.base_id) or self._store.get(request.base_id)
        if base is None:
            return _failure(FailureReason.INVALID, "That monster is not known to the forge.")

        shaped = base
        changes: list[str] = []
        if request.damage_swap is not None:
            swap = request.damage_swap
            shaped = swap_damage_type(shaped, swap.from_, swap.to)
            changes.append(f"its {swap.from_.value} damage became {swap.to.value} damage")
        if request.template is not None:
            shaped = get_template(request.template).apply(shaped)
            changes.append("it is a stronger, elite version")
        context = RenameContext(
            base_name=base.name,
            base_description=base.description,
            creature_type=base.type.value,
            size=base.size.value,
            cr=shaped.challenge.cr,
            changes=tuple(changes),
        )

        feedback: list[str] = []
        attempts = 1 + self._settings.max_retries
        for attempt in range(1, attempts + 1):
            if not self._cap.reserve():
                return _failure(FailureReason.RESTING, _RESTING)
            try:
                named = self._generator.rename(context, feedback)
            except GeneratorUnavailable:
                return _failure(FailureReason.ERROR, _COULD_NOT_REACH)
            except BadOutput as problem:
                feedback = [str(problem)]
                _log_failed_attempt("reskin", attempt, attempts, feedback)
                continue
            self._cap.record_tokens(named.input_tokens, named.output_tokens)

            outcome = self._accept_reskin(shaped, base, named.name, named.description, named.generator, changes)
            if isinstance(outcome, GenerateSuccess):
                self._store.remember_reskin(request.cache_key, outcome.monster.id)
                return outcome
            feedback = outcome
            _log_failed_attempt("reskin", attempt, attempts, feedback)
        return _failure(FailureReason.ERROR, _GAVE_UP)

    def _accept_reskin(
        self, shaped: Monster, base: Monster, name: str, description: str, generator: str, changes: list[str]
    ) -> GenerateSuccess | list[str]:
        try:
            candidate = self._rebuild(
                shaped, id=_new_id(name), name=name, description=description, source=Source.RESKIN, validated=False, parent_id=base.id, generator=generator
            )
        except ValidationError as problem:
            return [f"The name or description was not usable: {problem.errors()[0]['msg']}."]
        report = self._reskin_validator.validate(candidate, ValidationContext(existing_names=self._store.names()))
        if report.status is Status.REJECTED:
            return [f.message for f in report.errors]
        try:
            self._store.add(report.monster)
        except DuplicateMonster:
            return ["That name is already taken. Choose a different one."]
        notes = [change[0].upper() + change[1:] + "." for change in changes] + [f.message for f in report.corrections]
        return GenerateSuccess(monster=report.monster, notes=notes)

    @staticmethod
    def _rebuild(monster: Monster, **changes: object) -> Monster:
        """A copy with some fields replaced, checked from scratch: unlike ``model_copy`` this refuses bad values
        (an empty name, a description that is far too long) instead of accepting them silently."""
        return Monster.model_validate({**monster.model_dump(), **changes})
