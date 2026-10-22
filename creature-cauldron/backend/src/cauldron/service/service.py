"""The generation service: the one place that decides what happens to a request.

Order of events, cheapest first:

1. ``lookup``: is there already a stored monster that fits and that the visitor does not have? Free.
2. ``create``: otherwise ask the AI. Every attempt takes one call from the daily cap *before* it is made. The monster
   the AI returns goes through the validator and a check that it really fits the request; if either complains, the complaints
   are sent back to the AI and it tries again, up to ``max_retries`` more times. A monster that never passes is thrown away.
3. ``lookup_reskin`` / ``create_reskin``: the same idea for reskins. Code changes the numbers (damage swap, remix theme and move, level up);
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
from cauldron.options import DamageTheme, Source
from cauldron.remix.engine import remix, resolve
from cauldron.remix.graft import MAX_PICKS, Borrowable, borrowable, graft
from cauldron.remix.moves import MOVES
from cauldron.remix.reflavor import apply_renames, rename_candidates
from cauldron.service.brief import build_brief, effective_bounds
from cauldron.service.generators import BadOutput, GeneratorUnavailable, MonsterGenerator
from cauldron.service.limits import DailyCap
from cauldron.service.matching import mismatches
from cauldron.service.models import FailureReason, GenerateFailure, GenerateRequest, GenerateSuccess, ReskinRequest
from cauldron.service.prompts import RenameContext
from cauldron.service.settings import Settings
from cauldron.service.store import DuplicateMonster, MonsterStore
from cauldron.templates import retarget_name
from cauldron.validator import CrConsistencyCheck, Outcome, Status, ValidationContext, Validator, default_checks

Result = GenerateSuccess | GenerateFailure

MAX_REFLAVORS = 3  # a monster keeps at most this many reflavors; after that a press hands back one of them
RESTING_MESSAGE = "The forge is resting, back tomorrow. The library still works."
_COULD_NOT_REACH = "The forge could not be reached just now. Try again in a little while."
_PLACEHOLDER_MOVE = "Signature Move"
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

    # --- asking the AI ----------------------------------------------------------------------------------

    def _attempts(self, kind: str, ask, accept) -> Result:
        """Ask the AI, check what it says, and try again with the problems as feedback: one try and up to ``max_retries`` more.

        Every attempt takes a call from the day's allowance BEFORE it is made, and every reply is billed whether or not it
        was usable. `ask(feedback)` makes the call; `accept(answer)` gives the stored success or the list of problems."""
        if not self._generator.available:
            return _failure(FailureReason.ERROR, _COULD_NOT_REACH)  # without spending any of the day's allowance
        feedback: list[str] = []
        attempts = 1 + self._settings.max_retries
        for attempt in range(1, attempts + 1):
            if not self._cap.reserve():
                return _failure(FailureReason.RESTING, RESTING_MESSAGE)
            try:
                answer = ask(feedback)
            except GeneratorUnavailable:
                return _failure(FailureReason.ERROR, _COULD_NOT_REACH)
            except BadOutput as problem:
                self._cap.record_tokens(problem.input_tokens, problem.output_tokens)
                feedback = [str(problem)]
                _log_failed_attempt(kind, attempt, attempts, feedback)
                continue
            self._cap.record_tokens(answer.input_tokens, answer.output_tokens)
            outcome = accept(answer)
            if isinstance(outcome, GenerateSuccess):
                return outcome
            feedback = outcome
            _log_failed_attempt(kind, attempt, attempts, feedback)
        return _failure(FailureReason.ERROR, _GAVE_UP)

    def _find_base(self, base_id: str) -> Monster | None:
        """A monster a reskin may start from: one the server ships with, or one it generated."""
        return self._library.get(base_id) or self._store.get(base_id)

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

        return self._attempts(
            "generate",
            lambda feedback: self._generator.generate(brief, feedback),
            lambda generated: self._accept(generated.monster, generated.generator, wanted),
        )

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

    def settle(self, request: ReskinRequest) -> ReskinRequest:
        """The request with any "surprise" decided, so that it can be looked up (and cached) like any other.

        An unknown base is left alone: ``create_reskin`` refuses it."""
        if not request.has_surprise:
            return request
        base = self._find_base(request.base_id)
        if base is None:
            return request
        theme, move = resolve(base, request.theme, request.move, self._rng)
        return request.model_copy(update={"theme": theme, "move": move})

    def lookup_reskin(self, request: ReskinRequest) -> Monster | None:
        """A reskin made earlier for exactly this request. Free. A request with a surprise in it has no earlier answer.

        A reflavor has no choices, so it is answered from the monster's stored reflavors once there are MAX_REFLAVORS of them
        (a random one); until then each press makes a new one."""
        if request.reflavor:
            variants = self._store.reflavors(request.base_id)
            return self._rng.choice(variants) if len(variants) >= MAX_REFLAVORS else None
        return None if request.has_surprise or request.forge_chooses else self._store.reskin(request.cache_key)

    @staticmethod
    def _shape(base: Monster, request: ReskinRequest, move_name: str) -> tuple[Monster, list[str]]:
        """The numbers of a reskin, all by code: the theme and move, then the level up. Returns the monster and what changed."""
        theme = DamageTheme(request.theme) if request.theme else None
        remixed = remix(base, theme, request.move, move_name, request.level_up, defences=not request.damage_only)
        return remixed.monster, remixed.changes

    def create_reskin(self, request: ReskinRequest) -> Result:
        request = self.settle(request)
        base = self._find_base(request.base_id)
        if base is None:
            return _failure(FailureReason.INVALID, "That monster is not known to the forge.")
        if request.reflavor:
            return self._reflavor(base)
        if request.donor_id is not None:
            return self._polymorph(request, base)
        move = MOVES[request.move] if request.move is not None else None
        if move is not None and not move.applies_to(base):
            return _failure(FailureReason.INVALID, f"The move {move.label} does not fit that monster.")

        # A first pass with a stand-in move name gives the challenge rating and the list of changes for the AI to read.
        preview, changes = self._shape(base, request, _PLACEHOLDER_MOVE)
        if not changes:  # a damage-only theme the monster already had, with nothing else asked for
            return _failure(FailureReason.INVALID, "Nothing could be changed for that monster. Try a different theme or move.")
        context = RenameContext(
            base_name=base.name,
            base_description=base.description,
            creature_type=base.type.value,
            size=base.size.value,
            cr=preview.challenge.cr,
            changes=tuple(c for c in changes if not c.startswith("New move")),
            theme=request.theme,
            move_label=move.label.lower() if move else None,
            move_blurb=move.blurb if move else None,
        )

        def accept(named) -> GenerateSuccess | list[str]:
            if move is not None and not named.move_name:
                return ["The new move needs a name: give move_name."]
            shaped, changes = self._shape(base, request, named.move_name or _PLACEHOLDER_MOVE)
            outcome = self._accept_reskin(shaped, base, named.name, named.description, named.generator, changes)
            if isinstance(outcome, GenerateSuccess):
                self._store.remember_reskin(request.cache_key, outcome.monster.id)
            return outcome

        return self._attempts("reskin", lambda feedback: self._generator.rename(context, feedback), accept)

    def graft_options(self, base_id: str, donor_id: str) -> list[Borrowable] | GenerateFailure:
        """What the donor could lend the base. Free: no AI."""
        base, donor = self._find_base(base_id), self._find_base(donor_id)
        if base is None or donor is None:
            return _failure(FailureReason.INVALID, "That monster is not known to the forge.")
        if base.id == donor.id:
            return _failure(FailureReason.INVALID, "A creature cannot borrow from itself.")
        return borrowable(base, donor)

    def _polymorph(self, request: ReskinRequest, base: Monster) -> Result:
        """The base with features of the donor, chosen by the visitor or (forge_chooses) by the AI. The AI never sets a number."""
        assert request.donor_id is not None
        offered = self.graft_options(base.id, request.donor_id)
        if isinstance(offered, GenerateFailure):
            return offered
        if not offered:
            return _failure(FailureReason.INVALID, "That creature has nothing this one could borrow.")
        donor = self._find_base(request.donor_id)
        assert donor is not None
        if request.legendary and base.legendary_actions is not None:
            return _failure(FailureReason.INVALID, f"{base.name} already has legendary actions.")
        known = {b.key for b in offered}
        if any(key not in known for key in request.borrow):
            return _failure(FailureReason.INVALID, f"{donor.name} cannot lend that to {base.name}.")

        if request.forge_chooses:
            cr, changes, options = base.challenge.cr, (), tuple((b.key, b.label) for b in offered)
        else:
            preview = graft(base, donor, request.borrow, request.level_up, request.legendary)
            cr, changes, options = preview.monster.challenge.cr, tuple(preview.changes), ()
        context = RenameContext(
            base_name=base.name,
            base_description=base.description,
            creature_type=base.type.value,
            size=base.size.value,
            cr=cr,
            changes=changes,
            donor_name=donor.name,
            donor_description=donor.description,
            graft_options=options,
        )

        def accept(named) -> GenerateSuccess | list[str]:
            keys = request.borrow
            if request.forge_chooses:
                keys = [k for k in dict.fromkeys(named.picks) if k in known][:MAX_PICKS]
                if not keys:
                    return ["Pick at least one feature from the list to borrow: give picks, using the keys exactly as written."]
            result = graft(base, donor, keys, request.level_up, request.legendary)
            outcome = self._accept_reskin(result.monster, base, named.name, named.description, named.generator, result.changes)
            if isinstance(outcome, GenerateSuccess) and not request.forge_chooses:
                self._store.remember_reskin(request.cache_key, outcome.monster.id)
            return outcome

        return self._attempts("reskin", lambda feedback: self._generator.rename(context, feedback), accept)

    def _reflavor(self, base: Monster) -> Result:
        """A new name, description and ability names for `base`. No number is touched."""
        context = RenameContext(
            base_name=base.name,
            base_description=base.description,
            creature_type=base.type.value,
            size=base.size.value,
            cr=base.challenge.cr,
            changes=(),
            reflavor=True,
            rename_candidates=tuple(rename_candidates(base)),
            avoid_names=tuple(m.name for m in self._store.reflavors(base.id)),
        )

        def accept(named) -> GenerateSuccess | list[str]:
            renamed = apply_renames(base, named.renames)
            if renamed.problems:
                return renamed.problems
            changes = ["Reflavored: a new name and description, with every number as it was", *renamed.changes]
            outcome = self._accept_reskin(renamed.monster, base, named.name, named.description, named.generator, changes)
            if isinstance(outcome, GenerateSuccess):
                self._store.remember_reflavor(base.id, outcome.monster.id)
            return outcome

        return self._attempts("reskin", lambda feedback: self._generator.rename(context, feedback), accept)

    def _accept_reskin(
        self, shaped: Monster, base: Monster, name: str, description: str, generator: str, changes: list[str]
    ) -> GenerateSuccess | list[str]:
        # The text of the base monster speaks of it by name ("the zombie"); the reskin must speak of itself.
        shaped = retarget_name(shaped, base.name, name)
        try:
            candidate = self._rebuild(
                shaped, id=_new_id(name), name=name, description=description, source=Source.RESKIN, validated=False, parent_id=base.id, generator=generator, changes=changes
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
        notes = [*changes, *(f.message for f in report.corrections)]
        return GenerateSuccess(monster=report.monster, notes=notes)

    @staticmethod
    def _rebuild(monster: Monster, **changes: object) -> Monster:
        """A copy with some fields replaced, checked from scratch: unlike ``model_copy`` this refuses bad values
        (an empty name, a description that is far too long) instead of accepting them silently."""
        return Monster.model_validate({**monster.model_dump(), **changes})
