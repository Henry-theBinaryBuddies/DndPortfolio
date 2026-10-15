import os
import sys
from pathlib import Path

# Tests must never read the developer's real .env or talk to Discord: pin everything first.
# (config only fills variables that are absent, so these win over .env.)
os.environ.update({
    "CHRONOMANCER_DEV": "1",
    "DATABASE_URL": "sqlite://",
    "CHRONOMANCER_BACKGROUND": "0",
    "CHRONOMANCER_AUTO_MIGRATE": "0",
    "DISCORD_BOT_TOKEN": "",
    "DISCORD_CLIENT_ID": "test-client-id",
    "DISCORD_CLIENT_SECRET": "test-client-secret",
    "DISCORD_REDIRECT_URI": "http://testserver/auth/callback",
    "DISCORD_DEV_GUILD_ID": "",
    "PUBLIC_BASE_URL": "http://testserver",
    "SECRET_KEY": "test-secret-key",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from app import db as dbmod
from app.main import app
from app.ratelimit import auth_limiter, availability_limiter


@pytest.fixture()
def client():
    dbmod.Base.metadata.drop_all(dbmod.engine)
    dbmod.init_db()
    auth_limiter.reset()
    availability_limiter.reset()
    with TestClient(app, base_url="http://testserver") as c:
        yield c


@pytest.fixture()
def db():
    """A bare database session for service/bot-logic tests that do not need HTTP."""
    dbmod.Base.metadata.drop_all(dbmod.engine)
    dbmod.init_db()
    with dbmod.SessionLocal() as session:
        yield session


def make_client():
    """A second, independent browser session against the same app and database."""
    return TestClient(app, base_url="http://testserver")


def login(c, discord_id, name, tz="UTC"):
    r = c.post("/api/dev/login", json={"discord_id": discord_id, "display_name": name,
                                       "timezone": tz})
    assert r.status_code == 200, r.text
    return r.json()
