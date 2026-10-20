"""The web layer: FastAPI endpoints, rate limits, CORS and error shapes.

This file is deliberately thin. It turns HTTP requests into calls on ``GenerationService`` and results back into HTTP
responses; every decision about monsters lives in the service. Everything the app needs is passed to ``create_app``, so
tests build an app around fakes.

Endpoints (all under /api/v1):

* GET  /health    {"status": "ok" | "resting"}
* GET  /library   every monster the server has generated
* POST /generate  filters in, a monster or a failure out
* POST /reskin    a base monster id plus a damage swap and/or template in, a monster or a failure out

Failures always have the same body, ``{"ok": false, "reason": ..., "message": ...}``, which is what the web page already
knows how to show. The HTTP status says the same thing for anything else that reads it: 422 invalid, 429 rate-limited
(with a Retry-After header), 503 resting, 502 the AI could not be reached or gave up, 500 anything unexpected.
"""

import json
import logging
import math
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from cauldron.monster import Monster
from cauldron.service.limits import RateLimiter, client_address
from cauldron.service.models import FailureReason, GenerateFailure, GenerateRequest, GenerateSuccess, ReskinRequest
from cauldron.service.service import GenerationService
from cauldron.service.settings import Settings

log = logging.getLogger("cauldron")

API = "/api/v1"
MAX_BODY_BYTES = 64_000
LIBRARY_FILES = ("sample-monsters.json", "srd-monsters.json")

_STATUS = {
    FailureReason.INVALID: 422,
    FailureReason.RATE_LIMITED: 429,
    FailureReason.RESTING: 503,
    FailureReason.OFFLINE: 503,
    FailureReason.ERROR: 502,
}


def load_library(settings: Settings) -> dict[str, Monster]:
    """The server's static monsters (the samples and the SRD), by id. These are the monsters a reskin may start from."""
    library: dict[str, Monster] = {}
    found = False
    for name in LIBRARY_FILES:
        path: Path = settings.library_dir / name
        if not path.exists():
            continue
        found = True
        for raw in json.loads(path.read_text(encoding="utf-8")):
            monster = Monster.model_validate(raw)
            library[monster.id] = monster
    if not found:
        raise FileNotFoundError(f"No monster files ({', '.join(LIBRARY_FILES)}) in {settings.library_dir}")
    return library


def _failure_response(failure: GenerateFailure, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse(failure.model_dump(mode="json"), status_code=_STATUS[failure.reason], headers=headers)


def _success_response(success: GenerateSuccess) -> JSONResponse:
    # exclude_none leaves unset fields out, so the answer looks like the static monster files.
    return JSONResponse(success.model_dump(mode="json", exclude_none=True))


def create_app(settings: Settings, service: GenerationService) -> FastAPI:
    # The automatic documentation pages are switched off: the API is for the page, not for browsing.
    app = FastAPI(title="Creature Cauldron", docs_url=None, redoc_url=None, openapi_url=None)

    ai_limiter = RateLimiter([(60, settings.ip_per_minute), (3600, settings.ip_per_hour)])
    cache_limiter = RateLimiter([(60, settings.cache_per_minute)])

    # --- CORS: only the web page's own address may call the API from a browser --------------------------

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
        allow_credentials=False,
        max_age=600,
    )

    # --- errors always use the failure shape -------------------------------------------------------------

    @app.middleware("http")
    async def refuse_huge_bodies(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            failure = GenerateFailure(reason=FailureReason.INVALID, message="The request is too large.")
            return JSONResponse(failure.model_dump(mode="json"), status_code=413)
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        message = f"The request was not valid{f' ({where})' if where else ''}: {first.get('msg', 'unreadable')}."
        return _failure_response(GenerateFailure(reason=FailureReason.INVALID, message=message))

    @app.exception_handler(Exception)
    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        log.exception("Unexpected error handling %s", request.url.path)  # details go to the log, never to the visitor
        return JSONResponse(
            GenerateFailure(reason=FailureReason.ERROR, message="Something went wrong on the server.").model_dump(mode="json"), status_code=500
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"ok": False, "reason": "error", "message": str(error.detail)}, status_code=error.status_code)

    # --- helpers ------------------------------------------------------------------------------------------

    def visitor(request: Request) -> str:
        peer = request.client.host if request.client else None
        return client_address(request.headers, peer, settings.trusted_proxy_header)

    def too_many(wait: float) -> JSONResponse:
        failure = GenerateFailure(reason=FailureReason.RATE_LIMITED, message="Slow down a little: try again in a minute.")
        return _failure_response(failure, headers={"Retry-After": str(max(1, math.ceil(wait)))})

    # --- endpoints ----------------------------------------------------------------------------------------

    @app.get(f"{API}/health")
    def health() -> dict[str, str]:
        return {"status": "resting" if service.resting() else "ok"}

    @app.get(f"{API}/library")
    def library() -> JSONResponse:
        return JSONResponse([m.model_dump(mode="json", exclude_none=True) for m in service.generated_monsters()])

    @app.post(f"{API}/generate")
    def generate(body: GenerateRequest, request: Request) -> JSONResponse:
        who = visitor(request)
        decision = cache_limiter.allow(who)
        if not decision.allowed:
            return too_many(decision.retry_after)

        cached = service.lookup(body)
        if cached is not None:
            return _success_response(GenerateSuccess(monster=cached, notes=["From the shared library of generated monsters."]))

        if service.resting():
            return _failure_response(
                GenerateFailure(reason=FailureReason.RESTING, message="The forge is resting, back tomorrow. The library still works.")
            )
        decision = ai_limiter.allow(who)
        if not decision.allowed:
            return too_many(decision.retry_after)

        result = service.create(body)
        return _success_response(result) if isinstance(result, GenerateSuccess) else _failure_response(result)

    @app.post(f"{API}/reskin")
    def reskin(body: ReskinRequest, request: Request) -> JSONResponse:
        who = visitor(request)
        decision = cache_limiter.allow(who)
        if not decision.allowed:
            return too_many(decision.retry_after)

        cached = service.lookup_reskin(body)
        if cached is not None:
            return _success_response(GenerateSuccess(monster=cached, notes=["A reskin made earlier for the same choices."]))

        if service.resting():
            return _failure_response(
                GenerateFailure(reason=FailureReason.RESTING, message="The forge is resting, back tomorrow. The library still works.")
            )
        decision = ai_limiter.allow(who)
        if not decision.allowed:
            return too_many(decision.retry_after)

        result = service.create_reskin(body)
        return _success_response(result) if isinstance(result, GenerateSuccess) else _failure_response(result)

    return app
