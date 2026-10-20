"""The generator interface: the one place the service talks to an AI model.

``MonsterGenerator`` is an abstract base class, like ``Action``, ``Check`` and ``Template``. It says what any generator must
do (make a monster from a brief; write a new name and description for a reskin) and nothing about how. The real subclass
calls Haiku. ``ScriptedGenerator`` below returns answers a test has prepared, so every test of the service runs without
spending money or touching the network (N-9).
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field

from cauldron.monster import Monster
from cauldron.service.brief import Brief
from cauldron.service.prompts import RenameContext


class GeneratorUnavailable(Exception):
    """The AI service could not be reached or refused the call. Trying again at once would not help."""


class BadOutput(Exception):
    """The AI answered, but not in a usable form. The message says what was wrong and is passed to the next attempt."""


@dataclass(frozen=True)
class GeneratedMonster:
    monster: Monster
    generator: str  # who made it, for example "claude-haiku-5-5"
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class GeneratedName:
    name: str
    description: str
    generator: str
    input_tokens: int = 0
    output_tokens: int = 0
    move_name: str | None = None  # only for a remix that added a signature move


class MonsterGenerator(ABC):
    @abstractmethod
    def generate(self, brief: Brief, feedback: Sequence[str]) -> GeneratedMonster:
        """A new monster for the brief. `feedback` lists problems with the previous attempt (empty on the first)."""

    @abstractmethod
    def rename(self, context: RenameContext, feedback: Sequence[str]) -> GeneratedName:
        """A new name and description for a reskinned monster, and a name for its new move when it has one. Numbers are never part of the answer."""


@dataclass
class ScriptedGenerator(MonsterGenerator):
    """A generator for tests: it returns, in order, the answers (or raises the errors) it was given, and remembers what it was asked."""

    monsters: list[GeneratedMonster | Exception] = field(default_factory=list)
    names: list[GeneratedName | Exception] = field(default_factory=list)
    generate_calls: list[tuple[Brief, list[str]]] = field(default_factory=list)
    rename_calls: list[tuple[RenameContext, list[str]]] = field(default_factory=list)

    def generate(self, brief: Brief, feedback: Sequence[str]) -> GeneratedMonster:
        self.generate_calls.append((brief, list(feedback)))
        if len(self.generate_calls) > len(self.monsters):
            raise AssertionError("ScriptedGenerator was asked for more monsters than it was given")
        answer = self.monsters[len(self.generate_calls) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer

    def rename(self, context: RenameContext, feedback: Sequence[str]) -> GeneratedName:
        self.rename_calls.append((context, list(feedback)))
        if len(self.rename_calls) > len(self.names):
            raise AssertionError("ScriptedGenerator was asked for more names than it was given")
        answer = self.names[len(self.rename_calls) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer
