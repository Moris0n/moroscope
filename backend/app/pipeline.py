"""Forecast pipeline: profile snapshot -> read sources (web search fallback) -> forecast agent -> .ics."""

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

import httpx

from .config import AgentConfig, PipelineDeps, PipelineError, load_agent_config
from .ics import build_ics_calendar
from .prompts import FORECAST_AGENT_PROMPT, QUERY_AGENT_PROMPT
from .sources import SourcesConfig, gather_documents, select_sources, trim_documents
from .validation import (
    MAX_EXCERPT_LENGTH,
    MAX_RESULT_CONTENT_LENGTH,
    MAX_RESULTS,
    MONTH_NAMES,
    is_http_url,
    is_utf8_safe,
    is_uuid,
    parse_llm_json,
    parse_month_range,
    primary_sign,
    profile_mode,
    sanitize_life_context,
    sanitize_profile,
    validate_agent_query,
    validate_forecast_payload,
    validate_user_profile,
)
from .webpages import Target

logger = logging.getLogger("uvicorn.error")

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
NEBIUS_ATTEMPTS = 2
# With fewer default sources than this, the open web is searched as well.
MIN_CURATED_SOURCES = 2


async def _post_json(deps: PipelineDeps, service: str, url: str, **kwargs: Any) -> Any:
    try:
        response = await deps.http.post(url, **kwargs)
    except httpx.TimeoutException:
        raise PipelineError(504, "Upstream request timed out.") from None
    except httpx.HTTPError:
        raise PipelineError(502, "Upstream request failed.") from None
    if not response.is_success:
        raise PipelineError(502, f"{service} failed (HTTP {response.status_code}).")
    try:
        body = response.json()
    except ValueError:
        raise PipelineError(502, f"{service.split()[0]} returned a non-JSON response.") from None
    if not is_utf8_safe(body):
        raise PipelineError(502, f"{service.split()[0]} returned malformed text.")
    return body


async def call_nebius_chat(
    config: AgentConfig, deps: PipelineDeps, system_prompt: str, user_payload: Any
) -> Any:
    """One JSON answer from the model. A cut-off or unparseable answer is asked for once more."""
    request = {
        "model": config.nebius_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False, separators=(",", ":")),
            },
        ],
        "response_format": {"type": "json_object"},
    }
    problem = ""
    for attempt in range(NEBIUS_ATTEMPTS):
        body = await _post_json(
            deps,
            "Nebius chat request",
            f"{config.nebius_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {config.nebius_api_key}"},
            json=request,
        )
        try:
            choice = body["choices"][0]
            content, finish = choice["message"]["content"], choice.get("finish_reason")
        except (KeyError, IndexError, TypeError):
            content, finish = None, None
        if not isinstance(content, str) or not content.strip():
            problem = (
                "Nebius ran out of output tokens before answering."
                if finish == "length"
                else "Nebius returned an empty completion."
            )
        else:
            try:
                return parse_llm_json(content)
            except ValueError as exc:
                problem = (
                    "Nebius ran out of output tokens; its answer was cut off."
                    if finish == "length"
                    else "Nebius returned malformed JSON."
                )
                # Sizes and position only: the answer itself may hold the user's life context.
                logger.warning(
                    "Unparseable model answer (attempt %d): finish_reason=%s, %d chars, %s",
                    attempt + 1,
                    finish,
                    len(content),
                    exc,
                )
    raise PipelineError(502, problem)


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
    body = await _post_json(deps, "Tavily search", TAVILY_SEARCH_URL, json=request)
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


def _write_profile_snapshot(data_dir: Path, profile: Any, profile_id: str) -> dict[str, Any]:
    directory = data_dir / "profiles"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = directory / f"{profile_id}.json"
    if target.parent != directory:
        raise PipelineError(400, "Invalid profileId.")
    tmp = directory / f".{profile_id}.{uuid.uuid4()}.tmp"
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(sanitize_profile(profile), handle, indent=2, ensure_ascii=False)
        read_back = json.loads(tmp.read_text(encoding="utf-8"))
        if validate_user_profile(read_back):
            raise PipelineError(500, "Profile snapshot failed validation.")
        snapshot = sanitize_profile(read_back)
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
    deps: PipelineDeps, profile: Any, profile_id: str | None
) -> tuple[str, dict[str, Any]]:
    """Atomically persist the sanitized profile; returns (profile id, stored snapshot)."""
    resolved_id = profile_id if profile_id is not None else str(uuid.uuid4())
    if not is_uuid(resolved_id):
        raise PipelineError(400, "profileId must be a valid UUID.")
    snapshot = await asyncio.to_thread(_write_profile_snapshot, deps.data_dir, profile, resolved_id)
    return resolved_id, snapshot


def _person(snapshot: dict[str, Any], life_context: dict[str, Any]) -> dict[str, Any]:
    """What the forecast agent learns about the user: signs, focus topics and the life context.

    Never the name, the birth date, time or place, or a timezone.
    """
    sign, kind = primary_sign(snapshot)
    person: dict[str, Any] = {
        "sign": sign,
        "signKind": kind,
        "focusTopics": snapshot.get("priorities") or [],
    }
    if profile_mode(snapshot) == "personal":
        for key in ("sunSign", "moonSign", "risingSign"):
            if snapshot.get(key):
                person[key] = snapshot[key]
        if life_context:
            person["lifeContext"] = life_context
    return person


def _empty_result(theme: str, month_key: str) -> dict[str, Any]:
    return {"overall_theme": theme, "events": [], "ics_content": build_ics_calendar([], month_key)}


async def run_forecast_pipeline(
    profile: Any,
    custom_excerpt: str | None,
    deps: PipelineDeps,
    on_step: Callable[[int], None],
    profile_id: str | None = None,
    sources: SourcesConfig | None = None,
) -> dict[str, Any]:
    saved_id, snapshot = await save_profile_snapshot(deps, profile, profile_id)
    # The life context goes to the forecast agent only; it is not part of the stored snapshot.
    person = _person(snapshot, sanitize_life_context(profile))
    on_step(1)

    month_range = parse_month_range(snapshot.get("targetMonth"))
    if not month_range:
        raise PipelineError(400, 'targetMonth must be in "Month YYYY" format.')
    month_key = f"{month_range.year}-{month_range.month:02d}"
    target = Target(person["sign"], MONTH_NAMES[month_range.month - 1], month_range.year)
    month = {
        "firstDate": month_range.first_date,
        "lastDate": month_range.last_date,
        "label": target.label,
    }

    config = load_agent_config(deps.env)

    on_step(2)
    exclusive, selected = select_sources(sources or SourcesConfig())
    gathered = await gather_documents(deps, selected, target)
    documents, report = gathered.documents, gathered.report

    sites = [source for source in selected if source.domain]
    if sites:
        # Bare sites the user added cannot be read directly: search them, and only them.
        query = f"{target.sign} monthly horoscope {target.label} key dates"
        try:
            found = await run_tavily_search(config, deps, query, [s.domain or "" for s in sites])
        except PipelineError as exc:
            found = []
            report.extend(source.report("failed", exc.message) for source in sites)
        else:
            for source in sites:
                own = [d for d in found if d["source"].endswith(source.domain or "")]
                report.append(
                    source.report("used", documents=len(own))
                    if own
                    else source.report("no_forecast", f"No forecast for {target.label} was found.")
                )
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
                "sign": person["sign"],
                "signKind": person["signKind"],
                "month": month,
                "focusTopics": person["focusTopics"],
            },
        )
        query = validate_agent_query(query_output)
        if not query:
            raise PipelineError(502, "Query agent returned an invalid search query.")
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

    documents = trim_documents(documents)
    extras = {
        "profileId": saved_id,
        "sources": report,
        "evidence": {"mode": mode, "gap": not documents},
    }
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
        return {"result": _empty_result(theme, month_key), **extras}

    forecast_payload: dict[str, Any] = {"month": month, "person": person, "documents": documents}
    if isinstance(custom_excerpt, str) and custom_excerpt.strip():
        forecast_payload["customExcerpt"] = custom_excerpt[:MAX_EXCERPT_LENGTH]
    forecast_output = await call_nebius_chat(config, deps, FORECAST_AGENT_PROMPT, forecast_payload)
    errors, validated = validate_forecast_payload(
        forecast_output,
        month_range,
        person["focusTopics"],
        {d["url"] for d in documents},
    )
    if errors or validated is None:
        raise PipelineError(
            502,
            f"Forecast agent returned invalid data: {errors[0] if errors else 'schema violation'}.",
        )

    on_step(4)
    return {
        "result": {
            "overall_theme": validated["overall_theme"],
            "events": validated["events"],
            "ics_content": build_ics_calendar(validated["events"], month_key),
        },
        **extras,
    }
