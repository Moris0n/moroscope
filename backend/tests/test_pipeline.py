import asyncio
import json
import re
import uuid

import httpx
import pytest

from app.config import PipelineError, load_agent_config, load_allowed_hosts
from app.pipeline import run_forecast_pipeline
from app.prompts import FORECAST_AGENT_PROMPT, QUERY_AGENT_PROMPT

from .helpers import (
    DEFAULT_QUERY,
    FULL_ENV,
    UUID_PATTERN,
    VALID_PROFILE,
    Upstream,
    make_deps,
    profile_files,
    valid_event,
    valid_forecast,
)


async def run(upstream, profile=VALID_PROFILE, excerpt=None, profile_id=None, steps=None):
    on_step = steps.append if steps is not None else (lambda step: None)
    return await run_forecast_pipeline(profile, excerpt, make_deps(upstream), on_step, profile_id)


async def test_two_nebius_calls_bracket_exactly_one_tavily_call_in_order():
    upstream = Upstream()
    steps: list[int] = []
    out = await run(upstream, steps=steps)

    assert upstream.services == ["nebius", "tavily", "nebius"]
    assert steps == [1, 2, 3, 4]

    query_call = upstream.calls[0]
    assert query_call["url"] == "https://nebius.test/v1/chat/completions"
    assert query_call["headers"]["authorization"] == "Bearer test-nebius-key"
    assert query_call["body"]["model"] == "test-model"
    assert query_call["body"]["messages"][0] == {"role": "system", "content": QUERY_AGENT_PROMPT}
    assert query_call["body"]["response_format"] == {"type": "json_object"}
    query_data = json.loads(query_call["body"]["messages"][1]["content"])
    assert query_data["month"] == {"firstDate": "2026-11-01", "lastDate": "2026-11-30"}
    assert query_data["profile"]["sunSign"] == "Libra"
    assert "backendUrl" not in query_data["profile"]

    search = upstream.calls[1]["body"]
    assert search == {
        "api_key": "test-tavily-key",
        "query": DEFAULT_QUERY,
        "search_depth": "advanced",
        "max_results": 10,
        "include_answer": False,
        "include_raw_content": False,
    }

    forecast_call = upstream.calls[2]["body"]
    assert forecast_call["messages"][0]["content"] == FORECAST_AGENT_PROMPT
    forecast_data = json.loads(forecast_call["messages"][1]["content"])
    assert forecast_data["query"] == DEFAULT_QUERY
    assert len(forecast_data["results"]) == 2
    assert "backendUrl" not in forecast_data["profile"]
    assert "customExcerpt" not in forecast_data

    assert len(out["result"]["events"]) == 1
    assert "BEGIN:VCALENDAR" in out["result"]["ics_content"]
    assert re.match(UUID_PATTERN, out["profileId"])


async def test_custom_excerpt_is_bounded_and_search_results_are_sanitized():
    upstream = Upstream(
        tavily_results=[
            {"url": "https://astro.example/nov-2026", "title": "t" * 500, "content": "c" * 20000},
            {"url": "javascript:alert(1)", "title": "bad scheme"},
            "not an object",
        ]
    )
    await run(upstream, excerpt="e" * 9000)
    data = json.loads(upstream.calls[2]["body"]["messages"][1]["content"])
    assert len(data["customExcerpt"]) == 8000
    assert [r["url"] for r in data["results"]] == ["https://astro.example/nov-2026"]
    assert len(data["results"][0]["title"]) == 300
    assert len(data["results"][0]["content"]) == 12000


async def test_concurrent_same_profile_id_pipelines_each_use_their_own_snapshot():
    def respond(body):
        if body["messages"][0]["content"] == QUERY_AGENT_PROMPT:
            return {"query": "scoped query"}
        user = json.loads(body["messages"][1]["content"])
        day = user["month"]["firstDate"][:8] + "05"
        return valid_forecast(
            events=[valid_event(date=day, topics=[user["profile"]["priorities"][0]])]
        )

    upstream = Upstream(responder=respond)
    deps = make_deps(upstream)
    shared_id = str(uuid.uuid4())
    december = {**VALID_PROFILE, "targetMonth": "December 2026", "priorities": ["datingRomance"]}

    out_a, out_b = await asyncio.gather(
        run_forecast_pipeline(VALID_PROFILE, None, deps, lambda s: None, shared_id),
        run_forecast_pipeline(december, None, deps, lambda s: None, shared_id),
    )
    assert out_a["profileId"] == out_b["profileId"] == shared_id
    assert out_a["result"]["events"][0]["date"] == "2026-11-05"
    assert out_b["result"]["events"][0]["date"] == "2026-12-05"

    query_payloads = [
        json.loads(call["body"]["messages"][1]["content"])
        for call in upstream.calls
        if "nebius" in call["url"] and call["body"]["messages"][0]["content"] == QUERY_AGENT_PROMPT
    ]
    assert sorted(q["month"]["firstDate"] for q in query_payloads) == ["2026-11-01", "2026-12-01"]
    assert sorted(q["profile"]["priorities"][0] for q in query_payloads) == [
        "careerTransition",
        "datingRomance",
    ]
    assert [p.name for p in profile_files(deps)] == [f"{shared_id}.json"]


@pytest.mark.parametrize(
    "nebius_outputs",
    [
        [{"query": "x" * 400}],
        [{"query": "   "}],
        [["not", "an", "object"]],
        [
            {"query": "ok"},
            valid_forecast(events=[valid_event(source_urls=["https://fake.example/"])]),
        ],
        [{"query": "ok"}, valid_forecast(events=[valid_event(date="2027-11-05")])],
        [{"query": "ok"}, "just text"],
    ],
)
async def test_rejects_invalid_query_and_fabricated_forecast_fields(nebius_outputs):
    with pytest.raises(PipelineError) as error:
        await run(Upstream(nebius_outputs=nebius_outputs))
    assert error.value.status == 502


async def test_empty_search_evidence_gives_an_honest_empty_result():
    upstream = Upstream(
        tavily_results=[],
        nebius_outputs=[
            {"query": "q"},
            {"overall_theme": "No adequately dated sources found for this month.", "events": []},
        ],
    )
    out = await run(upstream)
    assert out["result"]["events"] == []
    assert "No adequately dated" in out["result"]["overall_theme"]
    assert "END:VCALENDAR" in out["result"]["ics_content"]


@pytest.mark.parametrize(
    ("upstream", "status"),
    [
        (Upstream(nebius_status=500), 502),
        (Upstream(nebius_error=httpx.ConnectError("refused")), 502),
        (Upstream(nebius_error=httpx.ReadTimeout("slow")), 504),
    ],
)
async def test_maps_upstream_failures_to_gateway_errors(upstream, status):
    with pytest.raises(PipelineError) as error:
        await run(upstream)
    assert error.value.status == status


async def test_malformed_upstream_bodies_are_gateway_errors():
    async def not_json(request):
        return httpx.Response(200, text="<html>")

    async def empty_completion(request):
        return httpx.Response(200, json={"choices": []})

    for handler in (not_json, empty_completion):
        deps = make_deps()
        deps.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with pytest.raises(PipelineError) as error:
            await run_forecast_pipeline(VALID_PROFILE, None, deps, lambda s: None)
        assert error.value.status == 502


async def test_missing_config_fails_after_the_profile_is_saved():
    deps = make_deps(env={})
    with pytest.raises(PipelineError) as error:
        await run_forecast_pipeline(VALID_PROFILE, None, deps, lambda s: None)
    assert error.value.status == 503
    assert "NEBIUS_API_KEY" in error.value.message
    assert len(profile_files(deps)) == 1


def test_load_agent_config_validates_the_base_url():
    config = load_agent_config(FULL_ENV)
    assert config.nebius_base_url == "https://nebius.test/v1"

    with pytest.raises(PipelineError) as error:
        load_agent_config({})
    assert error.value.status == 503

    for base_url, message in [
        ("https://user:pass@host/v1", "credentials"),
        ("https://host/v1?q=1", "query or fragment"),
        ("https://host/v1#frag", "query or fragment"),
        ("ftp://host/v1", "http(s)"),
        ("host/v1", "not a valid URL"),
    ]:
        with pytest.raises(PipelineError, match=re.escape(message)):
            load_agent_config({**FULL_ENV, "NEBIUS_BASE_URL": base_url})


def test_load_allowed_hosts_defaults_to_localhost_and_honours_override():
    default = load_allowed_hosts({"PORT": "8123"})
    assert {"localhost", "127.0.0.1:8123", "localhost:3000", "[::1]:8123"} <= default
    assert "localhost:9999" not in default
    assert load_allowed_hosts({"ALLOWED_HOSTS": "Moroscope.example.com, api.example.com:8443"}) == {
        "moroscope.example.com",
        "api.example.com:8443",
    }
