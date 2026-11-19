"""FastAPI application: profiles, chart, place search and the forecast endpoint (JSON or SSE)."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import ValidationError
from starlette.types import ASGIApp, Receive, Scope, Send

from .chart import ChartCalculator
from .config import PipelineError, load_allowed_hosts
from .models import (
    ApiModel,
    ChartRequestBody,
    ChartResponse,
    CuratedSourcesResponse,
    PlacesResponse,
    ProfileSaveRequest,
    ProfileSaveResponse,
    SynthesizeRequest,
    error_messages,
)
from .pipeline import PipelineDeps, run_forecast_pipeline, save_profile_snapshot
from .places import search_places
from .sources import curated_sources_public, sources_config
from .validation import is_utf8_safe

REPO_ROOT = Path(__file__).resolve().parents[2]
MAX_BODY_BYTES = 2 * 1024 * 1024
DISCONNECT_POLL_SECONDS = 0.1
DEFAULT_PORTS = {"http": 80, "https": 443}


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def _origin_host(origin: str) -> str | None:
    try:
        parts = urlsplit(origin)
        if not parts.scheme or not parts.hostname:
            return None
        host = parts.netloc.rpartition("@")[2].lower()
        if parts.port is not None and parts.port == DEFAULT_PORTS.get(parts.scheme):
            host = host.rsplit(":", 1)[0]
        return host
    except ValueError:
        return None


class HostGuardMiddleware:
    """Reject requests for unexpected hosts (DNS rebinding) and cross-origin browser requests."""

    def __init__(self, app: ASGIApp, deps: PipelineDeps) -> None:
        self.app = app
        self.deps = deps

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope["headers"]}
        host = headers.get("host", "").lower()
        if host not in self.deps.allowed_hosts:
            await _error(403, "Forbidden host.")(scope, receive, send)
            return
        origin = headers.get("origin")
        if origin and _origin_host(origin) != host:
            await _error(403, "Forbidden origin.")(scope, receive, send)
            return
        await self.app(scope, receive, send)


async def _read_json_body(request: Request) -> dict[str, Any] | JSONResponse:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return _error(413, "Request body is too large.")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BODY_BYTES:
            return _error(413, "Request body is too large.")
    try:
        parsed = json.loads(body) if body else {}
    except ValueError:
        return _error(400, "Request body must be valid JSON.")
    if not is_utf8_safe(parsed):
        return _error(400, "Request body contains invalid text.")
    return parsed if isinstance(parsed, dict) else {}


async def _read_request[M: ApiModel](request: Request, model: type[M]) -> M | JSONResponse:
    """The JSON body as `model`, or the 4xx answer saying what is wrong with it."""
    body = await _read_json_body(request)
    if isinstance(body, JSONResponse):
        return body
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        return _error(400, "; ".join(error_messages(exc)))


def _json(model: ApiModel) -> JSONResponse:
    return JSONResponse(model.to_json())


def _pipeline_failure(exc: BaseException) -> tuple[int, str]:
    if isinstance(exc, PipelineError):
        return exc.status, exc.message
    if isinstance(exc, (TimeoutError, asyncio.CancelledError)):
        return 504, "Forecast pipeline timed out or the client disconnected."
    return 500, "Forecast pipeline failed."


async def _cancel_on_disconnect(request: Request, task: asyncio.Task[Any]) -> None:
    while not task.done():
        if await request.is_disconnected():
            task.cancel()
            return
        await asyncio.wait({task}, timeout=DISCONNECT_POLL_SECONDS)


def _sse(event: str, data: Any) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def create_app(
    deps: PipelineDeps, static_dir: Path | None = None, chart: ChartCalculator | None = None
) -> FastAPI:
    app = FastAPI(title="Moroscope API", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(HostGuardMiddleware, deps=deps)
    calculator = chart or ChartCalculator()

    @app.get("/api/places")
    async def places(q: str = "") -> Response:
        return _json(PlacesResponse(results=await asyncio.to_thread(search_places, q)))

    @app.get("/api/sources/curated")
    async def curated_sources() -> Response:
        return _json(CuratedSourcesResponse(sources=curated_sources_public()))

    @app.post("/api/chart")
    async def compute_chart(request: Request) -> Response:
        body = await _read_request(request, ChartRequestBody)
        if isinstance(body, JSONResponse):
            return body
        try:
            chart = await asyncio.to_thread(calculator.compute, body.to_request())
            return _json(ChartResponse(**chart))
        except PipelineError as exc:
            return _error(exc.status, exc.message)

    @app.post("/api/profiles")
    async def save_profile(request: Request) -> Response:
        body = await _read_request(request, ProfileSaveRequest)
        if isinstance(body, JSONResponse):
            return body
        try:
            profile_id, _ = await save_profile_snapshot(deps, body.profile, body.profile_id)
        except PipelineError as exc:
            return _error(exc.status, exc.message)
        except (OSError, ValueError):
            return _error(500, "Failed to save profile.")
        return _json(ProfileSaveResponse(profile_id=profile_id))

    @app.post("/api/horoscope/synthesize")
    async def synthesize(request: Request) -> Response:
        body = await _read_request(request, SynthesizeRequest)
        if isinstance(body, JSONResponse):
            return body

        events: asyncio.Queue[tuple[str, Any] | None] = asyncio.Queue()

        async def run() -> dict[str, Any]:
            async with asyncio.timeout(deps.timeout_seconds):
                return await run_forecast_pipeline(
                    body.profile,
                    body.custom_excerpt,
                    deps,
                    lambda step: events.put_nowait(("progress", {"step": step})),
                    body.profile_id,
                    sources_config(body.sources),
                )

        task = asyncio.create_task(run())
        task.add_done_callback(lambda _: events.put_nowait(None))
        watcher = asyncio.create_task(_cancel_on_disconnect(request, task))

        async def finish() -> tuple[str, Any, int]:
            try:
                return "result", await task, 200
            except BaseException as exc:
                if isinstance(exc, asyncio.CancelledError) and not task.cancelled():
                    raise
                status, message = _pipeline_failure(exc)
                return "error", {"error": message}, status
            finally:
                watcher.cancel()

        if "text/event-stream" not in request.headers.get("accept", ""):
            _, payload, status = await finish()
            return JSONResponse(payload, status_code=status)

        async def stream() -> AsyncIterator[str]:
            try:
                yield ": connected\n\n"
                while (item := await events.get()) is not None:
                    yield _sse(*item)
                event, payload, _ = await finish()
                yield _sse(event, payload)
            finally:
                task.cancel()
                watcher.cancel()

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    if static_dir is not None:
        root = static_dir.resolve()

        @app.get("/{path:path}")
        async def frontend(path: str) -> Response:
            if path == "api" or path.startswith("api/"):
                return _error(404, "Not found.")
            candidate = (root / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(root):
                return FileResponse(candidate)
            return FileResponse(root / "index.html")

    return app


def create_default_app() -> FastAPI:
    """App factory for uvicorn: configuration from the environment and the repo-root .env."""
    load_dotenv(REPO_ROOT / ".env")
    env = os.environ
    http = httpx.AsyncClient(timeout=httpx.Timeout(170.0, connect=10.0))
    deps = PipelineDeps(
        env=env,
        http=http,
        data_dir=Path(env.get("DATA_DIR") or REPO_ROOT / "data"),
        allowed_hosts=load_allowed_hosts(env),
    )
    dist = REPO_ROOT / "dist"
    serve_frontend = env.get("APP_ENV") == "production" and (dist / "index.html").is_file()
    app = create_app(deps, static_dir=dist if serve_frontend else None)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        with suppress(Exception):
            await http.aclose()

    app.router.lifespan_context = lifespan
    return app
