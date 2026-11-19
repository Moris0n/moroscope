"""Forecast pipeline: profile snapshot -> read sources (web search fallback) -> extract and verify
dated events -> rank -> synthesize -> assemble, with the .ics."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from pydantic import ValidationError

from .config import AgentConfig, PipelineDeps, PipelineError, load_agent_config
from .extract import DocumentExtraction, extract_documents
from .forecast import assemble_forecast, empty_forecast, rank_events, synthesizer_payload
from .llm import call_nebius_chat, post_json
from .models import (
    LIFE_AREA_LABELS,
    AgentQuery,
    ForecastResponse,
    GeneralProfile,
    PersonalProfile,
    error_messages,
    parse_profile,
    stored_profile,
)
from .priorities import build_priorities
from .prompts import QUERY_AGENT_PROMPT, SYNTHESIZER_PROMPT
from .sources import SourcesConfig, gather_documents, select_sources, trim_documents
from .validation import (
    MAX_RESULT_CONTENT_LENGTH,
    MAX_RESULTS,
    MONTH_NAMES,
    is_http_url,
    is_uuid,
    parse_month_range,
    primary_sign,
)
from .webpages import Target

logger = logging.getLogger("uvicorn.error")

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
# With fewer default sources than this, the open web is searched as well.
MIN_CURATED_SOURCES = 2


async def run_tavily_search(
    config: AgentConfig, deps: PipelineDeps, query: str, include_domains: list[str] | None = None
) -> list[dict[str, str]]:
    """Search results as documents. `include_domains` limits the search to those sites."""
    request: dict[str, Any] = {
        "api_key": config.tavily_api_key,
        "query": query,
        "search_depth": "advanced",
        "max_results": 10,
        "include_answer": False,
        "include_raw_content": False,
    }
    if include_domains:
        request["include_domains"] = include_domains
    body = await post_json(deps, "Tavily search", TAVILY_SEARCH_URL, json=request)
    raw = body.get("results") if isinstance(body, dict) else None
    results = []
    for item in (raw if isinstance(raw, list) else [])[:MAX_RESULTS]:
        item = item if isinstance(item, dict) else {}
        url, title, content = item.get("url"), item.get("title"), item.get("content")
        if not is_http_url(url):
            continue
        results.append(
            {
                "url": url,
                "source": _site(url),
                "title": title[:300] if isinstance(title, str) else "",
                "content": content[:MAX_RESULT_CONTENT_LENGTH] if isinstance(content, str) else "",
            }
        )
    return results


def _site(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


Profile = GeneralProfile | PersonalProfile


def _write_profile_snapshot(data_dir: Path, profile: Profile, profile_id: str) -> Profile:
    directory = data_dir / "profiles"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / f"{profile_id}.json"
    if target.parent != directory:
        raise PipelineError(400, "Invalid profileId.")
    tmp = directory / f".{profile_id}.{uuid.uuid4()}.tmp"
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(stored_profile(profile), handle, indent=2, ensure_ascii=False)
        try:
            snapshot = parse_profile(json.loads(tmp.read_text(encoding="utf-8")))
        except ValidationError:
            raise PipelineError(500, "Profile snapshot failed validation.") from None
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    return snapshot


async def save_profile_snapshot(
    deps: PipelineDeps, profile: Profile, profile_id: str | None
) -> tuple[str, Profile]:
    """Atomically persist the profile without its life context; returns (id, stored snapshot)."""
    resolved_id = profile_id if profile_id is not None else str(uuid.uuid4())
    if not is_uuid(resolved_id):
        raise PipelineError(400, "profileId must be a valid UUID.")
    snapshot = await asyncio.to_thread(_write_profile_snapshot, deps.data_dir, profile, resolved_id)
    return resolved_id, snapshot


def reading_sign(snapshot: Profile) -> dict[str, Any]:
    """The sign the sources are read for, and what the search query agent may know besides.

    Never the name, the birth date, time or place, a timezone or the life context.
    """
    sign, kind = primary_sign(snapshot)
    return {"sign": sign, "signKind": kind, "focusAreas": list(snapshot.focus_areas)}


def _report_extraction(
    report: list[dict[str, Any]], urls: list[list[str]], results: list[DocumentExtraction]
) -> None:
    """Add to each source's report entry how many of its events were verified and dropped."""
    by_url = {result.url: result for result in results}
    for entry, own_urls in zip(report, urls):
        own = [by_url[url] for url in own_urls if url in by_url]
        if not own:
            continue
        entry["events"] = sum(len(result.events) for result in own)
        entry["dropped"] = sum(len(result.dropped) for result in own)
        if all(result.error for result in own):
            entry["status"] = "failed"
            entry["reason"] = "The dated events could not be extracted from its text."


async def run_forecast_pipeline(
    profile: Profile,
    custom_excerpt: str | None,
    deps: PipelineDeps,
    on_step: Callable[[int], None],
    profile_id: str | None = None,
    sources: SourcesConfig | None = None,
) -> dict[str, Any]:
    saved_id, snapshot = await save_profile_snapshot(deps, profile, profile_id)
    # The life context goes to the Synthesizer only, as the priorities worked out from it; it is
    # not part of the stored snapshot.
    life_context = profile.life_answers() if isinstance(profile, PersonalProfile) else {}
    reading = reading_sign(snapshot)
    on_step(1)

    month_range = parse_month_range(snapshot.target_month)
    if not month_range:
        raise PipelineError(400, 'targetMonth must be in "Month YYYY" format.')
    target = Target(reading["sign"], MONTH_NAMES[month_range.month - 1], month_range.year)
    month = {
        "firstDate": month_range.first_date,
        "lastDate": month_range.last_date,
        "label": target.label,
    }

    config = load_agent_config(deps.env)

    on_step(2)
    exclusive, selected = select_sources(sources or SourcesConfig())
    gathered = await gather_documents(deps, selected, target)
    documents, report, urls = gathered.documents, gathered.report, gathered.urls

    sites = [source for source in selected if source.domain]
    if sites:
        # Bare sites the user added cannot be read directly: search them, and only them.
        query = f"{target.sign} monthly horoscope {target.label} key dates"
        try:
            found = await run_tavily_search(config, deps, query, [s.domain or "" for s in sites])
        except PipelineError as exc:
            found = []
            report.extend(source.report("failed", exc.message) for source in sites)
            urls.extend([] for _ in sites)
        else:
            for source in sites:
                own = [d for d in found if d["source"].endswith(source.domain or "")]
                report.append(
                    source.report("used", documents=len(own))
                    if own
                    else source.report("no_forecast", f"No forecast for {target.label} was found.")
                )
                urls.append([d["url"] for d in own])
        documents.extend(found)

    mode = "user" if exclusive else "curated"
    if not exclusive and sum(entry["status"] == "used" for entry in report) < MIN_CURATED_SOURCES:
        # Too little from the default sources: fall back to an open web search.
        mode = "web"
        query_output = await call_nebius_chat(
            config,
            deps,
            QUERY_AGENT_PROMPT,
            {
                "sign": reading["sign"],
                "signKind": reading["signKind"],
                "month": month,
                "focusAreas": [LIFE_AREA_LABELS[area] for area in reading["focusAreas"]],
            },
        )
        try:
            query = AgentQuery.model_validate(query_output).query
        except ValidationError:
            raise PipelineError(502, "Query agent returned an invalid search query.") from None
        found = await run_tavily_search(config, deps, query)
        documents.extend(found)
        report.append(
            {
                "id": "web-search",
                "name": "Web search",
                "url": "",
                "origin": "web",
                "status": "used" if found else "no_forecast",
                "documents": len(found),
            }
        )
        urls.append([d["url"] for d in found])

    documents = trim_documents(documents)
    evidence = {"mode": mode, "gap": not documents}

    def answer(forecast: Any) -> dict[str, Any]:
        try:
            return ForecastResponse(
                result=forecast, profile_id=saved_id, sources=report, evidence=evidence
            ).to_json()
        except ValidationError as exc:
            logger.error("Forecast response failed validation: %s", error_messages(exc)[:3])
            raise PipelineError(500, "Forecast pipeline failed.") from None

    on_step(3)
    if not documents:
        # Nothing to cite, so nothing to write: the search is never broadened silently.
        theme = (
            f"None of your sources has a readable forecast for {target.label} yet, so no events "
            "were generated. Try again later, or also use the default sources."
            if exclusive
            else f"No forecast for {target.label} was found in the default sources or on the "
            "web yet, so no events were generated. Monthly forecasts usually appear in the last "
            "week of the month before."
        )
        on_step(4)
        on_step(5)
        return answer(empty_forecast(theme))

    # Extract: one call per document, with nothing about the user. Each event is then checked
    # against the text of its document; what fails is dropped and counted.
    extractions = await extract_documents(
        config, deps, month, month_range, reading["sign"], documents
    )
    _report_extraction(report, urls, extractions)
    verified = [event for extraction in extractions for event in extraction.events]

    # Rank: hand-picked focus areas, then what the life context points to, then the rest.
    priorities = build_priorities(reading["focusAreas"], life_context)
    events = rank_events(verified, priorities, reading["sign"])

    on_step(4)
    if not events:
        # No event held up, so there is nothing the Synthesizer could refer to.
        on_step(5)
        return answer(
            empty_forecast(
                f"The sources for {target.label} were read, but no dated event in them could be "
                "confirmed against the source text, so no events were generated."
            )
        )

    # Synthesize: wording only. The Synthesizer gets the events, never the source text.
    payload = synthesizer_payload(
        month,
        reading["sign"],
        priorities,
        life_context.get("upcomingEvents") or [],
        events,
        custom_excerpt,
    )
    synthesized = await call_nebius_chat(config, deps, SYNTHESIZER_PROMPT, payload)

    on_step(5)
    errors, forecast = assemble_forecast(synthesized, events, personal_notes=bool(life_context))
    if errors or forecast is None:
        raise PipelineError(
            502,
            f"Synthesizer returned invalid data: {errors[0] if errors else 'schema violation'}.",
        )
    return answer(forecast)
