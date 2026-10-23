"""Shared monsters for the remix tests: the 20 samples and the 333 SRD monsters."""

import json
from pathlib import Path

import pytest

from cauldron.monster import Monster
from cauldron.seed.importer import import_all

DATA = Path(__file__).parents[2] / "data" / "srd-2014" / "5e-SRD-Monsters.json"
SAMPLES = Path(__file__).parents[3] / "frontend" / "public" / "data" / "sample-monsters.json"


@pytest.fixture(scope="session")
def samples() -> list[Monster]:
    return [Monster.model_validate(m) for m in json.loads(SAMPLES.read_text(encoding="utf-8"))]


@pytest.fixture(scope="session")
def srd() -> list[Monster]:
    return import_all(json.loads(DATA.read_text(encoding="utf-8"))).monsters


@pytest.fixture(scope="session")
def everyone(samples, srd) -> list[Monster]:
    return [*samples, *srd]


@pytest.fixture(scope="session")
def named(everyone):
    by_name = {m.name: m for m in everyone}

    def lookup(name: str) -> Monster:
        return by_name[name]

    return lookup
