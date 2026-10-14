import hmac
import logging
import secrets
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, RedirectResponse

from . import config, discord_oauth, services
from .db import get_db
from .models import Member, User
from .ratelimit import limit_auth
from .schemas import DevLogin

log = logging.getLogger("chronomancer.auth")

router = APIRouter(prefix="/api")
oauth_router = APIRouter(prefix="/auth")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """CSRF defence in depth: state-changing requests must come from our own origin."""

    async def dispatch(self, request: Request, call_next):
        if request.method not in SAFE_METHODS:
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "cross-origin request blocked"}, status_code=403)
        return await call_next(request)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(401, "not logged in")
    return user


def user_json(user: User) -> dict:
    return {
        "id": user.id,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "timezone": user.timezone,
    }


def require_member(db: Session, campaign_id: int, user: User) -> Member:
    member = db.scalar(
        select(Member).where(Member.campaign_id == campaign_id, Member.user_id == user.id)
    )
    if member is None:
        # Same answer for "no such campaign" and "not yours": do not leak existence.
        raise HTTPException(404, "campaign not found")
    return member


def require_organizer(db: Session, campaign_id: int, user: User) -> Member:
    member = require_member(db, campaign_id, user)
    if member.role != "organizer":
        raise HTTPException(403, "organizer only")
    return member


@router.post("/dev/login", dependencies=[Depends(limit_auth)])
def dev_login(body: DevLogin, request: Request, db: Session = Depends(get_db)):
    """Fake login for local development only. Replaced by Discord OAuth in phase 2."""
    if not config.DEV_MODE:
        raise HTTPException(404, "not found")
    user = db.scalar(select(User).where(User.discord_id == body.discord_id))
    if user is None:
        user = User(discord_id=body.discord_id, display_name=body.display_name,
                    timezone=body.timezone)
        db.add(user)
    else:
        user.display_name = body.display_name
        user.timezone = body.timezone
    db.commit()
    request.session.clear()
    request.session["user_id"] = user.id
    return user_json(user)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_json(user)


@router.get("/config")
def public_config():
    """What the login page needs to know. Nothing secret."""
    return {"discord_login": config.OAUTH_ENABLED, "dev_login": config.DEV_MODE}


def safe_next(value: str | None) -> str:
    """Only same-site paths. Blocks open redirects (protocol-relative or backslash tricks)."""
    if (not value or not value.startswith("/") or value.startswith("//")
            or "\\" in value or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        return "/"
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:  # belt and braces: must be a plain path
        return "/"
    return value


def login_error_redirect(error: str, destination: str) -> RedirectResponse:
    """Back to the login page with a message, remembering where the user was headed."""
    target = f"/?login_error={error}"
    if destination != "/":
        target += "&next=" + quote(destination, safe="")
    return RedirectResponse(target, status_code=302)


@oauth_router.get("/login", dependencies=[Depends(limit_auth)])
def oauth_login(request: Request, next: str = "/"):
    if not config.OAUTH_ENABLED:
        raise HTTPException(404, "Discord login is not configured")
    state = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    request.session["oauth_next"] = safe_next(next)
    return RedirectResponse(discord_oauth.authorize_url(state), status_code=302)


@oauth_router.get("/callback", dependencies=[Depends(limit_auth)])
async def oauth_callback(request: Request, code: str | None = None, state: str | None = None,
                         error: str | None = None, db: Session = Depends(get_db)):
    expected = request.session.pop("oauth_state", None)
    destination = safe_next(request.session.pop("oauth_next", "/"))
    if error:  # the user pressed Cancel on Discord's consent screen
        return login_error_redirect("denied", destination)
    if not (code and state and expected
            and hmac.compare_digest(state.encode(), expected.encode())):
        # Expired tab, a second tab, or a forged callback. A readable page beats raw JSON.
        return login_error_redirect("expired", destination)
    try:
        token = await discord_oauth.exchange_code(code)
        profile = await discord_oauth.fetch_user(token)
    except discord_oauth.OAuthError as exc:
        log.warning("Discord login failed: %s", exc)
        return login_error_redirect("failed", destination)
    user = await run_in_threadpool(
        services.upsert_user, db, str(profile["id"]),
        discord_oauth.display_name(profile), discord_oauth.avatar_url(profile),
    )
    request.session.clear()  # fresh session on login: no fixation of a pre-login cookie
    request.session["user_id"] = user.id
    return RedirectResponse(destination, status_code=302)
