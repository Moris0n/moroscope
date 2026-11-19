"""The astrology sources a forecast is built from: the curated list, the user's own, selection."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from pydantic import ValidationError

from .config import PipelineDeps
from .models import SourcesRequest, error_messages
from .webpages import (
    MAX_DOCUMENT_LENGTH,
    NoForecast,
    SourceError,
    Target,
    astrology_zone,
    astrostyle,
    cafe_astrology,
    generic_page,
    sally_kirkman,
)
from .youtube import is_youtube_url, youtube_channel, youtube_url

Reader = Callable[[PipelineDeps, Target], Awaitable[list[dict[str, str]]]]

MAX_TOTAL_DOCUMENT_LENGTH = 90000
MIN_TRIMMED_DOCUMENT_LENGTH = 4000
SOURCE_TIMEOUT_SECONDS = 60.0
FOUND_TTL_SECONDS = 7 * 24 * 3600
NOT_PUBLISHED_TTL_SECONDS = 6 * 3600
RUX_CHANNEL_ID = "UCII6kihNiLhgxgO6kzXnyPw"


@dataclass(frozen=True)
class CuratedSource:
    id: str
    name: str
    author: str
    type: str  # "video" | "website"
    url: str
    cadence: str
    read: Reader


async def _rux(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
    return await youtube_channel(deps, target, RUX_CHANNEL_ID)


CURATED_SOURCES: tuple[CuratedSource, ...] = (
    CuratedSource(
        "rux-youtube",
        "Written in the Stars by Rux",
        "Rux",
        "video",
        "https://www.youtube.com/@WrittenintheStarsbyRux",
        "Monthly video with a chapter per sign, published a few days before the month starts",
        _rux,
    ),
    CuratedSource(
        "cafe-astrology",
        "Cafe Astrology",
        "Annie Heese",
        "website",
        "https://cafeastrology.com/thismonthinastrology.html",
        "Monthly overview, updated in the fourth week of the previous month",
        cafe_astrology,
    ),
    CuratedSource(
        "astrology-zone",
        "Astrology Zone",
        "Susan Miller",
        "website",
        "https://www.astrologyzone.com/horoscopes/",
        "Monthly forecast per sign",
        astrology_zone,
    ),
    CuratedSource(
        "astrostyle",
        "Astrostyle",
        "The AstroTwins",
        "website",
        "https://astrostyle.com/horoscopes/monthly/",
        "Monthly forecast per sign",
        astrostyle,
    ),
    CuratedSource(
        "sally-kirkman",
        "Sally Kirkman",
        "Sally Kirkman",
        "website",
        "https://sallykirkman.com/monthly-horoscopes/",
        "Monthly forecast per sign",
        sally_kirkman,
    ),
)
_CURATED_IDS = frozenset(source.id for source in CURATED_SOURCES)


def curated_sources_public() -> list[dict[str, str]]:
    return [
        {
            "id": s.id,
            "name": s.name,
            "author": s.author,
            "type": s.type,
            "url": s.url,
            "language": "en",
            "cadence": s.cadence,
        }
        for s in CURATED_SOURCES
    ]


@dataclass(frozen=True)
class SourcesConfig:
    disabled_curated: frozenset[str] = frozenset()
    user: tuple[tuple[str, str], ...] = ()  # (id, url) of the active user sources
    include_curated: bool = False


def sources_config(request: SourcesRequest | None) -> SourcesConfig:
    """The active user sources (one per page) and the curated ones that are switched off."""
    if request is None:
        return SourcesConfig()
    active: list[tuple[str, str]] = []
    seen: set[str] = set()
    for source in request.user:
        key = _url_key(source.url)
        if source.active and key not in seen:
            seen.add(key)
            active.append((source.id or source.url, source.url))
    return SourcesConfig(
        frozenset(request.disabled_curated) & _CURATED_IDS, tuple(active), request.include_curated
    )


def validate_sources_config(value: Any) -> tuple[list[str], SourcesConfig | None]:
    """Validate the `sources` part of a forecast request. Returns (errors, config)."""
    if value is None:
        return [], SourcesConfig()
    try:
        return [], sources_config(SourcesRequest.model_validate(value))
    except ValidationError as exc:
        return error_messages(exc, "sources"), None


def _url_key(url: str) -> str:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    query = f"?{parts.query}" if parts.query else ""
    return f"{host}{parts.path.rstrip('/')}{query}"


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


@dataclass(frozen=True)
class SelectedSource:
    id: str
    name: str
    url: str
    origin: str  # "curated" | "user"
    read: Reader | None = None
    domain: str | None = None  # a bare site: searched with Tavily instead of being read

    def report(self, status: str, reason: str = "", documents: int = 0) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "origin": self.origin,
            "status": status,
            "documents": documents,
        }
        if reason:
            entry["reason"] = reason
        return entry


def _user_source(source_id: str, url: str) -> SelectedSource:
    host = _host(url)
    if is_youtube_url(url):

        async def read_video(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
            return await youtube_url(deps, target, url)

        return SelectedSource(source_id, "YouTube channel", url, "user", read=read_video)
    parts = urlsplit(url)
    if parts.path in ("", "/") and not parts.query:
        return SelectedSource(source_id, host, url, "user", domain=host)

    async def read_page(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
        return await generic_page(deps, target, url)

    return SelectedSource(source_id, host, url, "user", read=read_page)


def select_sources(config: SourcesConfig) -> tuple[bool, list[SelectedSource]]:
    """(exclusive, sources): active user sources are used alone unless curated ones are asked for."""
    user = [_user_source(source_id, url) for source_id, url in config.user]
    curated = [
        SelectedSource(s.id, s.name, s.url, "curated", read=s.read)
        for s in CURATED_SOURCES
        if s.id not in config.disabled_curated
    ]
    if user and not config.include_curated:
        return True, user
    return False, user + curated


# --- cache ----------------------------------------------------------------------------------


def _cache_path(deps: PipelineDeps, source: SelectedSource, target: Target):
    key = json.dumps(
        [
            source.origin,
            source.id if source.origin == "curated" else source.url,
            target.label,
            target.sign,
        ]
    )
    return deps.data_dir / "cache" / "sources" / f"{hashlib.sha256(key.encode()).hexdigest()}.json"


def _now(deps: PipelineDeps) -> float:
    return (deps.now or time.time)()


def _read_cache(deps: PipelineDeps, source: SelectedSource, target: Target):
    try:
        entry = json.loads(_cache_path(deps, source, target).read_text(encoding="utf-8"))
        documents, saved_at = entry["documents"], float(entry["savedAt"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not isinstance(documents, list):
        return None
    ttl = FOUND_TTL_SECONDS if documents else NOT_PUBLISHED_TTL_SECONDS
    return documents if 0 <= _now(deps) - saved_at < ttl else None


def _write_cache(deps: PipelineDeps, source: SelectedSource, target: Target, documents) -> None:
    path = _cache_path(deps, source, target)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp.write_text(
            json.dumps({"savedAt": _now(deps), "documents": documents}, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)  # the cache is an optimisation; reading goes on without it


# --- gathering ------------------------------------------------------------------------------


@dataclass
class Gathered:
    documents: list[dict[str, str]] = field(default_factory=list)
    report: list[dict[str, Any]] = field(default_factory=list)

    @property
    def used(self) -> int:
        return sum(1 for entry in self.report if entry["status"] == "used")


async def _read_source(
    deps: PipelineDeps, source: SelectedSource, target: Target
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    assert source.read is not None
    documents = await asyncio.to_thread(_read_cache, deps, source, target)
    if documents is None:
        try:
            async with asyncio.timeout(SOURCE_TIMEOUT_SECONDS):
                documents = await source.read(deps, target)
        except NoForecast:
            documents = []
        except SourceError as exc:
            return [], source.report("failed", exc.reason)
        except TimeoutError:
            return [], source.report("failed", "Reading the source took too long.")
        except Exception:  # noqa: BLE001 - one broken reader must not fail the forecast
            return [], source.report("failed", "The source could not be read.")
        documents = [d for d in documents if d["content"].strip()]
        await asyncio.to_thread(_write_cache, deps, source, target, documents)
    if not documents:
        return [], source.report("no_forecast", f"No forecast for {target.label} was found.")
    return documents, source.report("used", documents=len(documents))


def trim_documents(documents: list[dict[str, str]]) -> list[dict[str, str]]:
    """Shorten the longest documents until the total fits the prompt budget; drop duplicates."""
    unique: dict[str, dict[str, str]] = {}
    for doc in documents:
        unique.setdefault(doc["url"], {**doc, "content": doc["content"][:MAX_DOCUMENT_LENGTH]})
    kept = list(unique.values())
    excess = sum(len(d["content"]) for d in kept) - MAX_TOTAL_DOCUMENT_LENGTH
    while excess > 0:
        longest = max(kept, key=lambda d: len(d["content"]))
        cut = min(excess, len(longest["content"]) - MIN_TRIMMED_DOCUMENT_LENGTH)
        if cut <= 0:
            kept.remove(longest)
            excess -= len(longest["content"])
            continue
        longest["content"] = longest["content"][:-cut]
        excess -= cut
    return kept


async def gather_documents(
    deps: PipelineDeps, sources: list[SelectedSource], target: Target
) -> Gathered:
    """Read every readable source at once. Bare-domain sources are left to the caller's search."""
    readable = [s for s in sources if s.read is not None]
    results = await asyncio.gather(*(_read_source(deps, s, target) for s in readable))
    gathered = Gathered()
    for documents, entry in results:
        gathered.documents.extend(documents)
        gathered.report.append(entry)
    return gathered
