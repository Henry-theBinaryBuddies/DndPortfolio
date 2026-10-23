"""The web layer: FastAPI endpoints, rate limits, CORS and error shapes.

This file is deliberately thin. It turns HTTP requests into calls on ``GenerationService`` and results back into HTTP
responses; every decision about monsters lives in the service. Everything the app needs is passed to ``create_app``, so
tests build an app around fakes.

Endpoints (all under /api/v1):

* GET  /health    {"status": "ok" | "resting"}
* GET  /library   every monster the server has generated
* POST /generate  filters in, a monster or a failure out
* POST /reskin    a base monster id plus a reflavor, a theme and/or move, a polymorph (a donor id and what to borrow), and/or a level up in,
                  a monster or a failure out
* POST /graft/options  a base id and a donor id in, the donor's features the base could borrow (free: no AI) or a failure out

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
from cauldron.service.models import (
    BorrowOption,
    FailureReason,
    GenerateFailure,
    GenerateRequest,
    GenerateSuccess,
    GraftOptions,
    GraftOptionsRequest,
    ReskinRequest,
)
from cauldron.service.service import RESTING_MESSAGE, GenerationService
from cauldron.service.settings import Settings

log = logging.getLogger("cauldron")

API = "/api/v1"
MAX_BODY_BYTES = 64_000
LIBRARY_FILES = ("sample-monsters.json", "srd-monsters.json", "a5e-monsters.json")

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


def _failure_response(failure: GenerateFailure, headers: dict[str, str] | None = None, status: int | None = None) -> JSONResponse:
    """A failure in the one shape the web page knows. The status is the reason's own unless one is given."""
    return JSONResponse(failure.model_dump(mode="json"), status_code=status or _STATUS[failure.reason], headers=headers)


def _error_body(status: int, message: str, reason: FailureReason = FailureReason.INVALID) -> JSONResponse:
    """A failure answer with a status of our own choosing (the ones in _STATUS cover only the service's own failures)."""
    return _failure_response(GenerateFailure(reason=reason, message=message), status=status)


def _success_response(success: GenerateSuccess) -> JSONResponse:
    # exclude_none leaves unset fields out, so the answer looks like the static monster files.
    return JSONResponse(success.model_dump(mode="json", exclude_none=True))


def create_app(settings: Settings, service: GenerationService) -> FastAPI:
    # The automatic documentation pages are switched off: the API is for the page, not for browsing.
    app = FastAPI(title="Creature Cauldron", docs_url=None, redoc_url=None, openapi_url=None)

    ai_limiter = RateLimiter([(60, settings.ip_per_minute), (3600, settings.ip_per_hour)])
    cache_limiter = RateLimiter([(60, settings.cache_per_minute)])

    # --- errors always use the failure shape -------------------------------------------------------------

    @app.middleware("http")
    async def guard_requests(request: Request, call_next):
        """Refuses a POST that is too big or does not say how big it is, and answers a crash with the usual failure body.

        Added BEFORE the CORS layer below, so CORS wraps it: even these answers carry the CORS headers the web page needs
        in order to read them (otherwise the browser reports a network error instead of our message)."""
        if request.method == "POST":
            length = request.headers.get("content-length", "")
            if not length.isdigit():
                return _error_body(411, "The request must say how large it is.")
            if int(length) > MAX_BODY_BYTES:
                return _error_body(413, "The request is too large.")
        try:
            return await call_next(request)
        except Exception:
            log.exception("Unexpected error handling %s", request.url.path)  # details go to the log, never to the visitor
            return _error_body(500, "Something went wrong on the server.", FailureReason.ERROR)

    # --- CORS: only the web page's own address may call the API from a browser (outermost, see above) ------

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
        allow_credentials=False,
        max_age=600,
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        message = f"The request was not valid{f' ({where})' if where else ''}: {first.get('msg', 'unreadable')}."
        return _failure_response(GenerateFailure(reason=FailureReason.INVALID, message=message))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, error: StarletteHTTPException) -> JSONResponse:
        return _error_body(error.status_code, str(error.detail), FailureReason.ERROR)

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
    def library(request: Request) -> JSONResponse:
        decision = cache_limiter.allow(visitor(request))  # it reads every stored monster, so it is limited like the other free answers
        if not decision.allowed:
            return too_many(decision.retry_after)
        return JSONResponse([m.model_dump(mode="json", exclude_none=True) for m in service.generated_monsters()])

    def serve(request: Request, cached, note: str, create) -> JSONResponse:
        """What every AI endpoint does, cheapest first: the cheap limit, then the free cached answer, then (only if the forge
        is not resting and the visitor is within the AI limit) the real thing."""
        who = visitor(request)
        decision = cache_limiter.allow(who)
        if not decision.allowed:
            return too_many(decision.retry_after)

        monster = cached()
        if monster is not None:
            return _success_response(GenerateSuccess(monster=monster, notes=[note]))

        if service.resting():
            return _failure_response(GenerateFailure(reason=FailureReason.RESTING, message=RESTING_MESSAGE))
        decision = ai_limiter.allow(who)
        if not decision.allowed:
            return too_many(decision.retry_after)

        result = create()
        return _success_response(result) if isinstance(result, GenerateSuccess) else _failure_response(result)

    @app.post(f"{API}/generate")
    def generate(body: GenerateRequest, request: Request) -> JSONResponse:
        return serve(request, lambda: service.lookup(body), "From the shared library of generated monsters.", lambda: service.create(body))

    @app.post(f"{API}/reskin")
    def reskin(body: ReskinRequest, request: Request) -> JSONResponse:
        settled = service.settle(body)  # a "surprise" is decided first, so a repeat of the same outcome is still free
        return serve(
            request,
            lambda: service.lookup_reskin(settled),
            "A reskin made earlier for the same choices.",
            lambda: service.create_reskin(settled),
        )

    @app.post(f"{API}/graft/options")
    def graft_options(body: GraftOptionsRequest, request: Request) -> JSONResponse:
        decision = cache_limiter.allow(visitor(request))
        if not decision.allowed:
            return too_many(decision.retry_after)
        found = service.graft_options(body.base_id, body.donor_id)
        if isinstance(found, GenerateFailure):
            return _failure_response(found)
        options = GraftOptions(options=[BorrowOption(key=b.key, kind=b.kind, label=b.label) for b in found])
        return JSONResponse(options.model_dump(mode="json"))

    return app
