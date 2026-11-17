"""Shared fixtures: sample data and a scripted stand-in for Nebius and Tavily."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any

import httpx

from app.config import local_allowed_hosts
from app.main import create_app
from app.pipeline import PipelineDeps

PORT = 8000
BASE_URL = f"http://127.0.0.1:{PORT}"
UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

FULL_ENV = {
    "NEBIUS_API_KEY": "test-nebius-key",
    "NEBIUS_BASE_URL": "https://nebius.test/v1/",
    "NEBIUS_MODEL": "test-model",
    "TAVILY_API_KEY": "test-tavily-key",
}

VALID_PROFILE: dict[str, Any] = {
    "name": "Test User",
    "birthDate": "1994-10-17",
    "birthTime": "08:45",
    "hasExactTime": True,
    "birthLocation": "New York, NY",
    "birthTimezone": "America/New_York",
    "operatingTimezone": "America/New_York",
    "sunSign": "Libra",
    "moonSign": "Taurus",
    "risingSign": "Scorpio",
    "useRisingPrimary": True,
    "activeCategories": ["career", "finance"],
    "targetMonth": "November 2026",
    "priorities": ["careerTransition", "financialPlanning"],
    "backendUrl": "",
}

TAVILY_RESULTS = [
    {
        "url": "https://astro.example/nov-2026",
        "title": "Nov forecast",
        "content": "Mars ingress on Nov 5",
    },
    {
        "url": "https://sky.example/scorpio",
        "title": "Scorpio rising",
        "content": "Venus transit Nov 12-14",
    },
]

DEFAULT_QUERY = "scorpio rising november 2026 horoscope dates"


def valid_event(**overrides: Any) -> dict[str, Any]:
    return {
        "date": "2026-11-05",
        "title": "Mars ingress window",
        "impact_type": "Opportunity",
        "summary": "A sourced transit event.",
        "topics": ["careerTransition"],
        "source_urls": ["https://astro.example/nov-2026"],
        **overrides,
    }


def valid_forecast(**overrides: Any) -> dict[str, Any]:
    return {
        "overall_theme": "A month of sourced transitions.",
        "events": [valid_event()],
        **overrides,
    }


def nebius_response(content: Any) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})


class Upstream:
    """Records upstream calls and answers them from a script."""

    def __init__(
        self,
        nebius_outputs: list[Any] | None = None,
        tavily_results: list[Any] | None = None,
        nebius_status: int | None = None,
        nebius_error: Exception | None = None,
        delay: float = 0.0,
        responder: Any = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.nebius_outputs = nebius_outputs or [{"query": DEFAULT_QUERY}, valid_forecast()]
        self.tavily_results = TAVILY_RESULTS if tavily_results is None else tavily_results
        self.nebius_status = nebius_status
        self.nebius_error = nebius_error
        self.delay = delay
        self.responder = responder
        self._nebius_index = 0

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        body = json.loads(request.content) if request.content else None
        self.calls.append({"url": url, "body": body, "headers": request.headers})
        if self.delay:
            await asyncio.sleep(self.delay)
        if "api.tavily.com" in url:
            return httpx.Response(200, json={"results": self.tavily_results})
        if self.nebius_error:
            raise self.nebius_error
        if self.nebius_status:
            return httpx.Response(self.nebius_status, text="err")
        if self.responder:
            return nebius_response(self.responder(body))
        index = min(self._nebius_index, len(self.nebius_outputs) - 1)
        self._nebius_index += 1
        return nebius_response(self.nebius_outputs[index])

    @property
    def services(self) -> list[str]:
        return ["tavily" if "tavily" in call["url"] else "nebius" for call in self.calls]


def make_deps(
    upstream: Upstream | None = None, env: dict[str, str] | None = None, port: int = PORT
) -> PipelineDeps:
    return PipelineDeps(
        env=FULL_ENV if env is None else env,
        http=httpx.AsyncClient(transport=httpx.MockTransport(upstream or Upstream())),
        data_dir=Path(tempfile.mkdtemp(prefix="moroscope-profiles-")),
        allowed_hosts=local_allowed_hosts(port),
    )


def api_client(deps: PipelineDeps, **app_kwargs: Any) -> httpx.AsyncClient:
    app = create_app(deps, **app_kwargs)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE_URL)


def profile_files(deps: PipelineDeps) -> list[Path]:
    directory = deps.data_dir / "profiles"
    return sorted(directory.iterdir()) if directory.exists() else []


def parse_sse(text: str) -> list[tuple[str, Any]]:
    events = []
    for block in text.split("\n\n"):
        if not block.startswith("event:"):
            continue
        event_line, data_line = block.split("\n", 1)
        events.append(
            (event_line.removeprefix("event: "), json.loads(data_line.removeprefix("data: ")))
        )
    return events
