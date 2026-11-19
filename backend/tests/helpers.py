"""Shared fixtures: sample data and a scripted stand-in for Nebius and Tavily."""

from __future__ import annotations

import asyncio
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import httpx

from app.config import local_allowed_hosts
from app.main import create_app
from app.models import parse_profile
from app.pipeline import PipelineDeps
from app.prompts import EXTRACTOR_PROMPT, QUERY_AGENT_PROMPT, SYNTHESIZER_PROMPT

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
    "targetMonth": "November 2026",
    "focusAreas": ["career", "money"],
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

FIXTURES = Path(__file__).parent / "fixtures"
RUX_FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCII6kihNiLhgxgO6kzXnyPw"
AZ_SCORPIO_URL = "https://www.astrologyzone.com/forecasts/scorpio-horoscope-for-november-2026/"
CAFE_URL = "https://cafeastrology.com/thismonthinastrology.html"
ASTROSTYLE_URL = "https://astrostyle.com/horoscopes/monthly/scorpio/"
SALLY_URL = "https://sallykirkman.com/scorpio-horoscope-november-2026/"
RUX_VIDEO_URL = "https://www.youtube.com/watch?v=nov26AAAAAA"
RUX_SCORPIO_URL = f"{RUX_VIDEO_URL}&t=180s"

# One cue every 20 seconds; the chapters of the fixture video start on the minute.
TRANSCRIPT = [
    (0.0, "hello everybody this is the general overview"),
    (20.0, "the new moon is on the 9th of november"),
    (60.0, "my dear aries"),
    (120.0, "my dear libras"),
    (180.0, "my dear scorpios"),
    (200.0, "on the 13th of november mercury and venus turn direct"),
    (240.0, "my dear sagittarians"),
]


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def source_pages() -> dict[str, str]:
    """Every curated source with a forecast for Scorpio, November 2026."""
    return {
        RUX_FEED_URL: fixture("youtube_feed.xml"),
        CAFE_URL: fixture("cafe_astrology.html"),
        "https://www.astrologyzone.com/horoscopes/": fixture("astrology_zone_index.html"),
        AZ_SCORPIO_URL: fixture("astrology_zone_scorpio_1.html"),
        f"{AZ_SCORPIO_URL}2/": fixture("astrology_zone_scorpio_2.html"),
        f"{AZ_SCORPIO_URL}3/": fixture("astrology_zone_scorpio_3.html"),
        ASTROSTYLE_URL: fixture("astrostyle_scorpio.html"),
        "https://sallykirkman.com/scorpio-monthly-horoscopes/": fixture(
            "sally_kirkman_listing.html"
        ),
        SALLY_URL: fixture("sally_kirkman_post.html"),
    }


def page_response(body: Any) -> httpx.Response:
    if isinstance(body, httpx.Response):
        return body
    content_type = "text/xml" if body.lstrip().startswith("<?xml") else "text/html"
    return httpx.Response(
        200, content=body.encode(), headers={"content-type": f"{content_type}; charset=utf-8"}
    )


def profile_model(**overrides: Any):
    """VALID_PROFILE (with overrides) as the validated model the pipeline takes."""
    return parse_profile({**VALID_PROFILE, **overrides})


_DAY_RE = re.compile(
    r"\b(?:nov(?:ember)?|dec(?:ember)?) (\d{1,2})\b|\bthe (\d{1,2})th\b", re.IGNORECASE
)


def extracted_event(**overrides: Any) -> dict[str, Any]:
    """An event as the Extractor returns it. The default quote is in the first Tavily result."""
    return {
        "date": "2026-11-05",
        "title": "Mars ingress window",
        "advice": "A sourced transit event.",
        "tone": "favourable",
        "lifeAreas": ["career"],
        "quote": "Mars ingress on Nov 5",
        **overrides,
    }


def auto_extraction(payload: dict[str, Any]) -> dict[str, Any]:
    """A well-behaved Extractor: one event for the first day the document names, quoted from it."""
    content = payload["document"]["content"]
    match = _DAY_RE.search(content)
    if not match:
        return {"events": []}
    day = int(match.group(1) or match.group(2))
    return {
        "events": [
            extracted_event(
                date=f"{payload['month']['firstDate'][:8]}{day:02d}",
                title=f"Event in {payload['document']['source']}",
                quote=content[max(0, match.start() - 25) : match.end()],
            )
        ]
    }


def auto_synthesis(payload: dict[str, Any]) -> dict[str, Any]:
    """A well-behaved Synthesizer: one group per event, no merging."""
    return {
        "theme": "A month of sourced transitions.",
        "groups": [
            {"eventIds": [event["id"]], "title": f"Synth: {event['title']}", "summary": "Summary."}
            for event in payload["events"]
        ],
    }


def nebius_response(content: Any) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})


class Upstream:
    """Records upstream calls and answers them from a script.

    `calls` holds the Nebius and Tavily calls. Nebius calls are told apart by their system prompt:
    the query agent answers `query`, the Extractor `extractor(payload)` and the Synthesizer
    `synthesizer(payload)` (each may also be a ready answer, or give a whole response); `responder(body)`, when given,
    answers every Nebius call instead. Source pages are served from `pages` (URL to HTML, XML or
    a ready response) and recorded in `page_calls`; any other page is a 404, so without `pages`
    no curated source is readable and the pipeline falls back to the web search.
    """

    def __init__(
        self,
        tavily_results: list[Any] | None = None,
        nebius_status: int | None = None,
        nebius_error: Exception | None = None,
        delay: float = 0.0,
        responder: Any = None,
        pages: dict[str, Any] | None = None,
        query: Any = None,
        extractor: Any = auto_extraction,
        synthesizer: Any = auto_synthesis,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.page_calls: list[str] = []
        self.pages = pages or {}
        self.tavily_results = TAVILY_RESULTS if tavily_results is None else tavily_results
        self.nebius_status = nebius_status
        self.nebius_error = nebius_error
        self.delay = delay
        self.responder = responder
        self.query = {"query": DEFAULT_QUERY} if query is None else query
        self.extractor = extractor
        self.synthesizer = synthesizer

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "GET":
            self.page_calls.append(url)
            return page_response(self.pages.get(url, httpx.Response(404, text="not found")))
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
        prompt = body["messages"][0]["content"]
        script = {
            QUERY_AGENT_PROMPT: self.query,
            EXTRACTOR_PROMPT: self.extractor,
            SYNTHESIZER_PROMPT: self.synthesizer,
        }[prompt]
        payload = json.loads(body["messages"][1]["content"])
        answer = script(payload) if callable(script) else script
        return answer if isinstance(answer, httpx.Response) else nebius_response(answer)

    def _nebius(self, prompt: str) -> list[dict[str, Any]]:
        return [
            json.loads(call["body"]["messages"][1]["content"])
            for call in self.calls
            if "tavily" not in call["url"] and call["body"]["messages"][0]["content"] == prompt
        ]

    @property
    def services(self) -> list[str]:
        """Which service each call went to, with the Nebius calls named by their agent."""
        names = {
            QUERY_AGENT_PROMPT: "query",
            EXTRACTOR_PROMPT: "extract",
            SYNTHESIZER_PROMPT: "synthesize",
        }
        return [
            "tavily"
            if "tavily" in call["url"]
            else names.get(call["body"]["messages"][0]["content"], "nebius")
            for call in self.calls
        ]

    @property
    def extractor_payloads(self) -> list[dict[str, Any]]:
        return self._nebius(EXTRACTOR_PROMPT)

    @property
    def synthesizer_payloads(self) -> list[dict[str, Any]]:
        return self._nebius(SYNTHESIZER_PROMPT)


PRIVATE_HOSTS = {"intranet.example": "10.0.0.5", "metadata.example": "169.254.169.254"}


async def fake_resolve(host: str) -> list[str]:
    """DNS stand-in: every name is public except the ones in PRIVATE_HOSTS."""
    return [PRIVATE_HOSTS.get(host, "93.184.216.34")]


def fake_transcript(video_id: str) -> list[tuple[float, str]]:
    if video_id != "nov26AAAAAA":
        raise RuntimeError("no transcript")
    return TRANSCRIPT


def make_deps(
    upstream: Upstream | None = None, env: dict[str, str] | None = None, port: int = PORT
) -> PipelineDeps:
    return PipelineDeps(
        env=FULL_ENV if env is None else env,
        http=httpx.AsyncClient(transport=httpx.MockTransport(upstream or Upstream())),
        data_dir=Path(tempfile.mkdtemp(prefix="moroscope-profiles-")),
        allowed_hosts=local_allowed_hosts(port),
        fetch_transcript=fake_transcript,
        resolve_host=fake_resolve,
        page_pause_seconds=0.0,
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
