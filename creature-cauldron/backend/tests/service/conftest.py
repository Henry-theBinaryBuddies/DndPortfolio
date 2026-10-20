"""Shared helpers for the service tests: the 20 sample monsters and a few request builders."""

import json
from pathlib import Path

import pytest

from cauldron.monster import Monster

SAMPLES_PATH = Path(__file__).parents[3] / "frontend" / "public" / "data" / "sample-monsters.json"


@pytest.fixture(scope="session")
def samples() -> list[Monster]:
    return [Monster.model_validate(m) for m in json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))]


@pytest.fixture(scope="session")
def sample(samples):
    def lookup(name: str) -> Monster:
        return next(m for m in samples if m.name == name)

    return lookup
