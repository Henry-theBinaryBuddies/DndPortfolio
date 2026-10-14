from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app import config, discord_oauth
from app.auth import safe_next
from app.main import app
from app.models import User
from app.ratelimit import auth_limiter

from helpers import fresh

PROFILE = {"id": "777000111", "username": "aria_the_bold", "global_name": "Aria",
           "avatar": "abc123def"}


@pytest.fixture()
def raw(client):
    """A client that does not follow redirects, so we can inspect them."""
    with TestClient(app, base_url="http://testserver", follow_redirects=False) as c:
        yield c


def start_login(raw, next_path=None):
    url = "/auth/login" + (f"?next={next_path}" if next_path else "")
    resp = raw.get(url)
    assert resp.status_code == 302
    qs = parse_qs(urlparse(resp.headers["location"]).query)
    return resp, qs["state"][0]


def fake_discord(monkeypatch, profile=PROFILE, fail=False):
    async def exchange(code):
        if fail:
            raise discord_oauth.OAuthError("token request rejected: HTTP 400")
        assert code == "good-code"
        return "access-token"

    async def fetch(token):
        assert token == "access-token"
        return profile

    monkeypatch.setattr(discord_oauth, "exchange_code", exchange)
    monkeypatch.setattr(discord_oauth, "fetch_user", fetch)


def test_public_config_exposes_only_flags(client):
    data = client.get("/api/config").json()
    assert data == {"discord_login": True, "dev_login": True}


def test_login_redirects_to_discord_with_expected_parameters(raw):
    resp, state = start_login(raw)
    loc = urlparse(resp.headers["location"])
    assert (loc.scheme, loc.netloc, loc.path) == ("https", "discord.com", "/oauth2/authorize")
    qs = parse_qs(loc.query)
    assert qs["client_id"] == ["test-client-id"]
    assert qs["redirect_uri"] == ["http://testserver/auth/callback"]
    assert qs["scope"] == ["identify"]  # no email, no guild list
    assert qs["response_type"] == ["code"]
    assert len(state) >= 32
    assert "test-client-secret" not in resp.headers["location"]


def test_each_login_attempt_gets_a_fresh_state(raw):
    _, a = start_login(raw)
    _, b = start_login(raw)
    assert a != b


def test_login_unavailable_when_not_configured(raw, monkeypatch):
    monkeypatch.setattr(config, "OAUTH_ENABLED", False)
    assert raw.get("/auth/login").status_code == 404


def test_successful_callback_logs_in_and_creates_user(raw, monkeypatch):
    fake_discord(monkeypatch)
    _, state = start_login(raw, "/campaign.html?id=3")
    resp = raw.get(f"/auth/callback?code=good-code&state={state}")
    assert resp.status_code == 302
    assert resp.headers["location"] == "/campaign.html?id=3"
    me = raw.get("/api/me").json()
    assert me["display_name"] == "Aria"
    assert me["avatar_url"] == "https://cdn.discordapp.com/avatars/777000111/abc123def.png"
    with fresh() as db:
        assert db.query(User).filter_by(discord_id="777000111").count() == 1


def test_returning_user_is_updated_not_duplicated(raw, monkeypatch):
    fake_discord(monkeypatch)
    for name in ("Aria", "Aria Renamed"):
        fake_discord(monkeypatch, {**PROFILE, "global_name": name})
        _, state = start_login(raw)
        raw.get(f"/auth/callback?code=good-code&state={state}")
    assert raw.get("/api/me").json()["display_name"] == "Aria Renamed"
    with fresh() as db:
        assert db.query(User).filter_by(discord_id="777000111").count() == 1


def test_username_used_when_no_global_name(raw, monkeypatch):
    fake_discord(monkeypatch, {"id": "42", "username": "plainname", "global_name": None, "avatar": None})
    _, state = start_login(raw)
    raw.get(f"/auth/callback?code=good-code&state={state}")
    me = raw.get("/api/me").json()
    assert me["display_name"] == "plainname" and me["avatar_url"] is None


def test_wrong_state_is_rejected_and_nobody_is_logged_in(raw, monkeypatch):
    fake_discord(monkeypatch)
    start_login(raw)
    resp = raw.get("/auth/callback?code=good-code&state=forged-state")
    assert resp.status_code == 302 and "login_error=expired" in resp.headers["location"]
    assert raw.get("/api/me").status_code == 401


def test_callback_without_starting_a_login_is_rejected(raw, monkeypatch):
    fake_discord(monkeypatch)
    resp = raw.get("/auth/callback?code=good-code&state=anything")
    assert resp.status_code == 302 and "login_error=expired" in resp.headers["location"]
    assert raw.get("/api/me").status_code == 401


def test_state_cannot_be_replayed(raw, monkeypatch):
    fake_discord(monkeypatch)
    _, state = start_login(raw)
    assert raw.get(f"/auth/callback?code=good-code&state={state}").status_code == 302
    raw.post("/api/logout")
    replay = raw.get(f"/auth/callback?code=good-code&state={state}")
    assert replay.status_code == 302 and "login_error=expired" in replay.headers["location"]
    assert raw.get("/api/me").status_code == 401


def test_non_ascii_state_does_not_crash(raw, monkeypatch):
    fake_discord(monkeypatch)
    start_login(raw)
    resp = raw.get("/auth/callback", params={"code": "good-code", "state": "café\U0001F409"})
    assert resp.status_code == 302 and "login_error=expired" in resp.headers["location"]


def test_user_denying_consent_returns_home_without_login(raw, monkeypatch):
    fake_discord(monkeypatch)
    start_login(raw)
    resp = raw.get("/auth/callback?error=access_denied&state=x")
    assert resp.status_code == 302 and resp.headers["location"] == "/?login_error=denied"
    assert raw.get("/api/me").status_code == 401


def test_discord_failure_returns_home_without_login(raw, monkeypatch):
    fake_discord(monkeypatch, fail=True)
    _, state = start_login(raw)
    resp = raw.get(f"/auth/callback?code=good-code&state={state}")
    assert resp.status_code == 302 and resp.headers["location"] == "/?login_error=failed"
    assert raw.get("/api/me").status_code == 401


@pytest.mark.parametrize("hostile", [
    "//evil.example", "https://evil.example/x", "/\\evil.example", "evil.example",
    "javascript:alert(1)", "/ok\nSet-Cookie:x=1", "", "/\t/evil.example", "/\x7f/x",
    "/\r\n/evil.example", "/a/\x00b",
])
def test_next_parameter_cannot_redirect_off_site(hostile):
    assert safe_next(hostile) == "/"


@pytest.mark.parametrize("fine", ["/", "/poll.html?id=4", "/campaign.html?id=2&x=y"])
def test_next_parameter_allows_local_paths(fine):
    assert safe_next(fine) == fine


def test_hostile_next_ends_at_home_after_login(raw, monkeypatch):
    fake_discord(monkeypatch)
    _, state = start_login(raw, "//evil.example")
    resp = raw.get(f"/auth/callback?code=good-code&state={state}")
    assert resp.headers["location"] == "/"


def test_login_endpoints_are_rate_limited(raw):
    auth_limiter.reset()
    codes = [raw.get("/auth/login").status_code for _ in range(35)]
    assert codes[:30] == [302] * 30
    assert 429 in codes[30:]


def test_avatar_url_rejects_odd_hashes():
    assert discord_oauth.avatar_url({"id": "1", "avatar": "../../x"}) is None
    assert discord_oauth.avatar_url({"id": "abc", "avatar": "ok"}) is None
    assert discord_oauth.avatar_url({"id": "1", "avatar": None}) is None


@pytest.mark.parametrize("uri,ok", [
    ("http://localhost:8000/auth/callback", True),
    ("https://chronomancer.example.com/auth/callback", True),
    ("https://discord.com/oauth2/authorize?client_id=1&permissions=8&scope=bot", False),
    ("http://localhost:8000/", False),
    ("http://localhost:8000/auth/callback/extra", False),
    ("localhost:8000/auth/callback", False),
    ("", False),
])
def test_redirect_uri_validation(uri, ok):
    assert (config.redirect_uri_problem(uri) is None) is ok
