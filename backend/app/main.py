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
from starlette.types import ASGIApp, Receive, Scope, Send

from .chart import ChartCalculator
from .config import PipelineError, load_allowed_hosts
from .pipeline import PipelineDeps, run_forecast_pipeline, save_profile_snapshot
from .places import search_places
from .validation import (
    MAX_EXCERPT_LENGTH,
    is_utf8_safe,
    is_uuid,
    validate_chart_request,
    validate_user_profile,
)

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


def _validate_profile_request(body: dict[str, Any]) -> JSONResponse | None:
    errors = validate_user_profile(body.get("profile"))
    if errors:
        return _error(400, "; ".join(errors))
    if body.get("profileId") is not None and not is_uuid(body["profileId"]):
        return _error(400, "profileId must be a valid UUID.")
    return None


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
        return JSONResponse({"results": await asyncio.to_thread(search_places, q)})

    @app.post("/api/chart")
    async def compute_chart(request: Request) -> Response:
        body = await _read_json_body(request)
        if isinstance(body, JSONResponse):
            return body
        errors, chart_request = validate_chart_request(body)
        if errors or chart_request is None:
            return _error(400, "; ".join(errors))
        try:
            return JSONResponse(await asyncio.to_thread(calculator.compute, chart_request))
        except PipelineError as exc:
            return _error(exc.status, exc.message)

    @app.post("/api/profiles")
    async def save_profile(request: Request) -> Response:
        body = await _read_json_body(request)
        if isinstance(body, JSONResponse):
            return body
        if invalid := _validate_profile_request(body):
            return invalid
        try:
            profile_id, _ = await save_profile_snapshot(
                deps, body["profile"], body.get("profileId")
            )
        except PipelineError as exc:
            return _error(exc.status, exc.message)
        except (OSError, ValueError):
            return _error(500, "Failed to save profile.")
        return JSONResponse({"profileId": profile_id})

    @app.post("/api/horoscope/synthesize")
    async def synthesize(request: Request) -> Response:
        body = await _read_json_body(request)
        if isinstance(body, JSONResponse):
            return body
        if invalid := _validate_profile_request(body):
            return invalid
        excerpt = body.get("customExcerpt")
        if excerpt is not None and (
            not isinstance(excerpt, str) or len(excerpt) > MAX_EXCERPT_LENGTH
        ):
            return _error(400, "customExcerpt must be a bounded string.")

        events: asyncio.Queue[tuple[str, Any] | None] = asyncio.Queue()

        async def run() -> dict[str, Any]:
            async with asyncio.timeout(deps.timeout_seconds):
                return await run_forecast_pipeline(
                    body["profile"],
                    excerpt,
                    deps,
                    lambda step: events.put_nowait(("progress", {"step": step})),
                    body.get("profileId"),
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
