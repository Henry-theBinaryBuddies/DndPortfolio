"""Builds the real server from the environment.

Run it with ``python -m cauldron.service`` (or, for production, ``uvicorn cauldron.service.main:create_default_app --factory``).
Everything is read from environment variables; see ``settings.py``. With no ANTHROPIC_API_KEY the server still starts: the
library, the cache and reskins already made keep working, and anything that needs the AI says the forge cannot be reached.
"""

import os
from collections.abc import Mapping

from fastapi import FastAPI

from cauldron.service.app import create_app, load_library
from cauldron.service.haiku import build_generator
from cauldron.service.limits import DailyCap
from cauldron.service.service import GenerationService
from cauldron.service.settings import Settings
from cauldron.service.store import MonsterStore


def create_default_app(env: Mapping[str, str] | None = None) -> FastAPI:
    env = os.environ if env is None else env
    settings = Settings.from_env(env)
    store = MonsterStore(settings.database_path)
    service = GenerationService(
        settings=settings,
        store=store,
        generator=build_generator(settings, env),
        cap=DailyCap(store, settings.daily_cap),
        library=load_library(settings),
    )
    return create_app(settings, service)
