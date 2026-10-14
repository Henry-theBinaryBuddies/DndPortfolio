import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import JSONResponse

from . import config
from .auth import OriginCheckMiddleware, oauth_router, router as auth_router
from .background import Background
from .db import init_db
from .routes import campaigns, polls
from .services import ServiceError

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def _configure_logging() -> None:
    logger = logging.getLogger("chronomancer")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_logging()
    log = logging.getLogger("chronomancer")
    if config.DISCORD_CLIENT_ID and config.DISCORD_CLIENT_SECRET and config.REDIRECT_URI_PROBLEM:
        log.error("Discord login is DISABLED: DISCORD_REDIRECT_URI is unusable because %s. "
                  "Set it to %s/auth/callback and register that exact URL in the Discord "
                  "Developer Portal under OAuth2 > Redirects.",
                  config.REDIRECT_URI_PROBLEM, config.PUBLIC_BASE_URL)
    init_db()
    background = Background()
    await background.start()
    app.state.background = background
    try:
        yield
    finally:
        await background.stop()


def create_app() -> FastAPI:
    if config.SECRET_KEY is None:
        raise RuntimeError("SECRET_KEY must be set unless CHRONOMANCER_DEV=1")
    app = FastAPI(title="Chronomancer", lifespan=lifespan)
    app.add_middleware(OriginCheckMiddleware)
    app.add_middleware(
        SessionMiddleware,
        secret_key=config.SECRET_KEY,
        same_site="lax",
        https_only=not config.DEV_MODE,
        max_age=60 * 60 * 24 * 14,
    )

    @app.exception_handler(ServiceError)
    async def service_error(_request: Request, exc: ServiceError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    app.include_router(auth_router)
    app.include_router(oauth_router)
    app.include_router(campaigns.router)
    app.include_router(polls.router)
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


app = create_app()
