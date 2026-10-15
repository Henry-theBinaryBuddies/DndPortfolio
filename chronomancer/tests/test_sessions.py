"""Logging out must end the session on the server, so a copied cookie stops working."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import background, services
from app.main import app
from app.models import WebSession

from conftest import login, make_client
from helpers import fresh

NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


def sessions():
    with fresh() as db:
        return db.scalars(select(WebSession).order_by(WebSession.created_at)).all()


def copy_of(client) -> TestClient:
    """Another 'browser' holding a copy of this one's cookies (what an attacker would have)."""
    clone = TestClient(app, base_url="http://testserver")
    for cookie in client.cookies.jar:
        clone.cookies.set(cookie.name, cookie.value)
    return clone


def test_logging_in_creates_a_server_side_session(client):
    login(client, "1", "DM")
    rows = sessions()
    assert len(rows) == 1 and len(rows[0].id) >= 40
    assert rows[0].expires_at - NOW() > timedelta(days=13)
    assert client.get("/api/me").status_code == 200


def test_the_cookie_does_not_carry_the_user_id(client):
    login(client, "1", "DM")
    import base64, json
    raw = next(c.value for c in client.cookies.jar if c.name == "session")
    payload = json.loads(base64.urlsafe_b64decode(raw.split(".")[0] + "=="))
    assert set(payload) == {"sid"} and "user_id" not in payload


def test_logging_out_kills_a_copied_cookie(client):
    login(client, "1", "DM")
    stolen = copy_of(client)
    assert stolen.get("/api/me").status_code == 200            # works while logged in
    client.post("/api/logout")
    assert client.get("/api/me").status_code == 401
    assert stolen.get("/api/me").status_code == 401            # the copy is dead too
    assert sessions() == []


def test_each_login_gets_a_new_session_and_replaces_the_cookie(client):
    login(client, "1", "DM")
    first = copy_of(client)
    login(client, "1", "DM")                                   # logging in again in the same browser
    assert len(sessions()) == 2 and len({s.id for s in sessions()}) == 2
    assert first.get("/api/me").status_code == 200             # the older session is a separate one
    client.post("/api/logout")
    assert first.get("/api/me").status_code == 200             # logging out ends only this browser's


def test_log_out_everywhere_ends_every_device(client):
    login(client, "1", "DM")
    phone = make_client()
    login(phone, "1", "DM")
    other_user = make_client()
    login(other_user, "2", "Aria")
    assert len(sessions()) == 3
    r = client.post("/api/logout-everywhere")
    assert r.status_code == 200 and r.json() == {"ended": 2}
    assert client.get("/api/me").status_code == 401 and phone.get("/api/me").status_code == 401
    assert other_user.get("/api/me").status_code == 200        # someone else's session is untouched


def test_log_out_everywhere_requires_a_login(client):
    assert client.post("/api/logout-everywhere").status_code == 401


def test_an_expired_session_is_refused(client):
    login(client, "1", "DM")
    with fresh() as db:
        for row in db.scalars(select(WebSession)):
            row.expires_at = NOW() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/me").status_code == 401


def test_a_made_up_or_missing_session_id_is_refused(client):
    assert client.get("/api/me").status_code == 401
    login(client, "1", "DM")
    with fresh() as db:                                       # the row vanishes (revoked server-side)
        for row in db.scalars(select(WebSession)):
            db.delete(row)
        db.commit()
    assert client.get("/api/me").status_code == 401


def test_old_cookies_that_only_hold_a_user_id_no_longer_work(client):
    """Cookies from before sessions were server-side must not log anyone in."""
    from itsdangerous import TimestampSigner
    import base64, json
    login(client, "1", "DM")
    client.cookies.clear()
    payload = base64.b64encode(json.dumps({"user_id": 1}).encode())
    signed = TimestampSigner("test-secret-key").sign(payload).decode()
    client.cookies.set("session", signed)
    assert client.get("/api/me").status_code == 401


def test_expired_sessions_are_purged_and_live_ones_kept(client):
    login(client, "1", "DM")
    keeper = make_client()
    login(keeper, "2", "Aria")
    with fresh() as db:
        first = db.scalars(select(WebSession).order_by(WebSession.created_at)).first()
        first.expires_at = NOW() - timedelta(days=1)
        db.commit()
        assert services.purge_expired_web_sessions(db) == 1
    assert len(sessions()) == 1 and keeper.get("/api/me").status_code == 200


def test_the_background_tick_purges_expired_sessions(client):
    login(client, "1", "DM")
    with fresh() as db:
        for row in db.scalars(select(WebSession)):
            row.expires_at = NOW() - timedelta(minutes=5)
        db.commit()
    background._db_tick()
    assert sessions() == []


def test_logout_without_a_session_is_harmless(client):
    assert client.post("/api/logout").status_code == 200


def test_discord_login_creates_a_session_too(client, monkeypatch):
    from app import discord_oauth

    async def exchange(code):
        return "tok"

    async def fetch(token):
        return {"id": "777", "username": "aria", "global_name": "Aria", "avatar": None}

    monkeypatch.setattr(discord_oauth, "exchange_code", exchange)
    monkeypatch.setattr(discord_oauth, "fetch_user", fetch)
    from urllib.parse import parse_qs, urlparse
    raw = TestClient(app, base_url="http://testserver", follow_redirects=False)
    state = parse_qs(urlparse(raw.get("/auth/login").headers["location"]).query)["state"][0]
    assert raw.get(f"/auth/callback?code=c&state={state}").status_code == 302
    assert len(sessions()) == 1 and raw.get("/api/me").json()["display_name"] == "Aria"
    stolen = copy_of(raw)
    raw.post("/api/logout")
    assert stolen.get("/api/me").status_code == 401
