"""Shared helpers for the seed tests: the real raw SRD data, looked up by its index (for example "aboleth")."""

import json
from pathlib import Path

import pytest

RAW_PATH = Path(__file__).parents[2] / "data" / "srd-2014" / "5e-SRD-Monsters.json"


@pytest.fixture(scope="session")
def raw_monsters() -> list[dict]:
    return json.loads(RAW_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def raw(raw_monsters):
    by_index = {m["index"]: m for m in raw_monsters}

    def lookup(index: str) -> dict:
        return by_index[index]

    return lookup
