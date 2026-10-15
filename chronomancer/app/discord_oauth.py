"""Discord OAuth2 authorization-code flow. Only the `identify` scope is requested, and the
access token is used once to read the profile, then discarded (never stored)."""
from urllib.parse import urlencode

import httpx

from . import config

AUTHORIZE_URL = "https://discord.com/oauth2/authorize"
API_BASE = "https://discord.com/api/v10"


class OAuthError(Exception):
    """Login with Discord failed. The message is safe to log, never contains secrets."""


def authorize_url(state: str) -> str:
    return AUTHORIZE_URL + "?" + urlencode({
        "client_id": config.DISCORD_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": config.DISCORD_REDIRECT_URI,
        "scope": "identify",
        "state": state,
        "prompt": "none",
    })


async def exchange_code(code: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{API_BASE}/oauth2/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": config.DISCORD_REDIRECT_URI,
                    "client_id": config.DISCORD_CLIENT_ID,
                    "client_secret": config.DISCORD_CLIENT_SECRET,
                },
            )
    except httpx.HTTPError as exc:
        raise OAuthError(f"token request failed: {type(exc).__name__}")
    if resp.status_code != 200:
        raise OAuthError(f"token request rejected: HTTP {resp.status_code}")
    token = resp.json().get("access_token")
    if not token:
        raise OAuthError("token response had no access_token")
    return token


async def fetch_user(access_token: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{API_BASE}/users/@me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise OAuthError(f"profile request failed: {type(exc).__name__}")
    if resp.status_code != 200:
        raise OAuthError(f"profile request rejected: HTTP {resp.status_code}")
    profile = resp.json()
    if not isinstance(profile, dict) or not profile.get("id"):
        raise OAuthError("profile response had no id")
    return profile


def display_name(profile: dict) -> str:
    return profile.get("global_name") or profile.get("username") or "Adventurer"


def avatar_url(profile: dict) -> str | None:
    h = profile.get("avatar")
    uid = profile.get("id")
    if h and uid and str(uid).isdigit() and all(c.isalnum() or c == "_" for c in h):
        return f"https://cdn.discordapp.com/avatars/{uid}/{h}.png"
    return None
