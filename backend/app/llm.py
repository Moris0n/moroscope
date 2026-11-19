"""The one way the app talks to Nebius and Tavily: a JSON request, a JSON answer."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from .config import AgentConfig, PipelineDeps, PipelineError
from .validation import is_utf8_safe, parse_llm_json

logger = logging.getLogger("uvicorn.error")

NEBIUS_ATTEMPTS = 2
# Room for the answer, including what a reasoning model spends on thinking before it writes.
# Without it the provider's default applies, which cut real forecasts off.
NEBIUS_MAX_OUTPUT_TOKENS = 8000


async def post_json(deps: PipelineDeps, service: str, url: str, **kwargs: Any) -> Any:
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
        "max_tokens": NEBIUS_MAX_OUTPUT_TOKENS,
    }
    problem = ""
    for attempt in range(NEBIUS_ATTEMPTS):
        body = await post_json(
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
