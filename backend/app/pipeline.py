"""Forecast pipeline: profile snapshot -> query agent -> web search -> forecast agent -> .ics."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import AgentConfig, PipelineError, load_agent_config
from .ics import build_ics_calendar
from .prompts import FORECAST_AGENT_PROMPT, QUERY_AGENT_PROMPT
from .validation import (
    MAX_EXCERPT_LENGTH,
    MAX_RESULT_CONTENT_LENGTH,
    MAX_RESULTS,
    is_http_url,
    is_utf8_safe,
    is_uuid,
    parse_llm_json,
    parse_month_range,
    sanitize_profile,
    validate_agent_query,
    validate_forecast_payload,
    validate_user_profile,
)

PIPELINE_TIMEOUT_SECONDS = 180.0
TAVILY_SEARCH_URL = "https://api.tavily.com/search"


@dataclass
class PipelineDeps:
    env: Mapping[str, str]
    http: httpx.AsyncClient
    data_dir: Path
    allowed_hosts: frozenset[str]
    timeout_seconds: float = PIPELINE_TIMEOUT_SECONDS


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
    body = await _post_json(
        deps,
        "Nebius chat request",
        f"{config.nebius_base_url}/chat/completions",
        headers={"Authorization": f"Bearer {config.nebius_api_key}"},
        json={
            "model": config.nebius_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": json.dumps(user_payload, ensure_ascii=False, separators=(",", ":")),
                },
            ],
            "response_format": {"type": "json_object"},
        },
    )
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        content = None
    if not isinstance(content, str) or not content.strip():
        raise PipelineError(502, "Nebius returned an empty completion.")
    try:
        return parse_llm_json(content)
    except ValueError:
        raise PipelineError(502, "Nebius returned malformed JSON.") from None


async def run_tavily_search(
    config: AgentConfig, deps: PipelineDeps, query: str
) -> list[dict[str, str]]:
    body = await _post_json(
        deps,
        "Tavily search",
        TAVILY_SEARCH_URL,
        json={
            "api_key": config.tavily_api_key,
            "query": query,
            "search_depth": "advanced",
            "max_results": 10,
            "include_answer": False,
            "include_raw_content": False,
        },
    )
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
                "title": title[:300] if isinstance(title, str) else "",
                "content": content[:MAX_RESULT_CONTENT_LENGTH] if isinstance(content, str) else "",
            }
        )
    return results


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


async def run_forecast_pipeline(
    profile: Any,
    custom_excerpt: str | None,
    deps: PipelineDeps,
    on_step: Callable[[int], None],
    profile_id: str | None = None,
) -> dict[str, Any]:
    saved_id, snapshot = await save_profile_snapshot(deps, profile, profile_id)
    on_step(1)

    month_range = parse_month_range(snapshot.get("targetMonth"))
    if not month_range:
        raise PipelineError(400, 'targetMonth must be in "Month YYYY" format.')
    month = {"firstDate": month_range.first_date, "lastDate": month_range.last_date}

    config = load_agent_config(deps.env)

    query_output = await call_nebius_chat(
        config, deps, QUERY_AGENT_PROMPT, {"profile": snapshot, "month": month}
    )
    query = validate_agent_query(query_output)
    if not query:
        raise PipelineError(502, "Query agent returned an invalid search query.")

    on_step(2)
    results = await run_tavily_search(config, deps, query)

    on_step(3)
    forecast_payload: dict[str, Any] = {
        "profile": snapshot,
        "month": month,
        "query": query,
        "results": results,
    }
    if isinstance(custom_excerpt, str) and custom_excerpt.strip():
        forecast_payload["customExcerpt"] = custom_excerpt[:MAX_EXCERPT_LENGTH]
    forecast_output = await call_nebius_chat(config, deps, FORECAST_AGENT_PROMPT, forecast_payload)
    errors, validated = validate_forecast_payload(
        forecast_output,
        month_range,
        snapshot.get("priorities") or [],
        {r["url"] for r in results},
    )
    if errors or validated is None:
        raise PipelineError(
            502,
            f"Forecast agent returned invalid data: {errors[0] if errors else 'schema violation'}.",
        )

    on_step(4)
    ics = build_ics_calendar(validated["events"], f"{month_range.year}-{month_range.month:02d}")
    return {
        "result": {
            "overall_theme": validated["overall_theme"],
            "events": validated["events"],
            "ics_content": ics,
        },
        "profileId": saved_id,
    }
