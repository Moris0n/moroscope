import asyncio
import json
import re
import uuid

import httpx
import pytest

from app.config import PipelineError, load_agent_config, load_allowed_hosts
from app.models import parse_profile
from app.pipeline import run_forecast_pipeline
from app.prompts import FORECAST_AGENT_PROMPT, QUERY_AGENT_PROMPT
from app.sources import validate_sources_config

from .helpers import (
    ASTROSTYLE_URL,
    AZ_SCORPIO_URL,
    CAFE_URL,
    DEFAULT_QUERY,
    FULL_ENV,
    RUX_SCORPIO_URL,
    SALLY_URL,
    UUID_PATTERN,
    VALID_PROFILE,
    Upstream,
    fixture,
    make_deps,
    profile_files,
    profile_model,
    source_pages,
    valid_event,
    valid_forecast,
)


async def run(
    upstream, profile=VALID_PROFILE, excerpt=None, profile_id=None, steps=None, sources=None
):
    on_step = steps.append if steps is not None else (lambda step: None)
    config = None
    if sources is not None:
        errors, config = validate_sources_config(sources)
        assert errors == []
    return await run_forecast_pipeline(
        parse_profile(profile), excerpt, make_deps(upstream), on_step, profile_id, config
    )


def user_payload(call):
    return json.loads(call["body"]["messages"][1]["content"])


PERSONAL_DATA = ("Test User", "1994-10-17", "08:45", "New York", "America/New_York")
LIFE_CONTEXT = {
    "relationship": "dating",
    "lookingForPartner": False,
    "work": "jobSeeking",
    "kids": ["under5"],
    "moneyFocus": "",
    "healthFocus": ["sleep"],
    "goals": "  Find a product role by spring  ",
    "upcomingEvents": [{"date": "2026-11-16", "label": "Final interview"}],
}


def cited_forecast(*urls):
    return valid_forecast(events=[valid_event(sourceUrls=list(urls))])


async def test_curated_sources_are_read_directly_without_any_search():
    upstream = Upstream(pages=source_pages(), nebius_outputs=[cited_forecast(SALLY_URL)])
    steps: list[int] = []
    out = await run(upstream, steps=steps)

    assert upstream.services == ["nebius"]
    assert steps == [1, 2, 3, 4]
    call = upstream.calls[0]
    assert call["body"]["messages"][0] == {"role": "system", "content": FORECAST_AGENT_PROMPT}
    data = user_payload(call)
    assert set(data) == {"month", "person", "documents"}
    assert data["month"] == {
        "firstDate": "2026-11-01",
        "lastDate": "2026-11-30",
        "label": "November 2026",
    }
    assert [d["url"] for d in data["documents"]] == [
        RUX_SCORPIO_URL,
        CAFE_URL,
        AZ_SCORPIO_URL,
        ASTROSTYLE_URL,
        SALLY_URL,
    ]
    by_url = {d["url"]: d["content"] for d in data["documents"]}
    assert by_url[RUX_SCORPIO_URL] == (
        "my dear scorpios on the 13th of november mercury and venus turn direct"
    )
    assert "page 3 of the Scorpio forecast" in by_url[AZ_SCORPIO_URL]
    assert "Libra" not in by_url[CAFE_URL] and "October" not in by_url[CAFE_URL]

    assert out["evidence"] == {"mode": "curated", "gap": False}
    assert [(s["id"], s["status"]) for s in out["sources"]] == [
        ("rux-youtube", "used"),
        ("cafe-astrology", "used"),
        ("astrology-zone", "used"),
        ("astrostyle", "used"),
        ("sally-kirkman", "used"),
    ]
    assert out["result"]["events"][0]["sourceUrls"] == [SALLY_URL]
    assert re.match(UUID_PATTERN, out["profileId"])


async def test_no_name_or_birth_data_ever_leaves_the_server():
    profile = {**VALID_PROFILE, "lifeContext": LIFE_CONTEXT}
    for pages in (source_pages(), {}):  # the direct path and the web-search fallback
        upstream = Upstream(
            pages=pages,
            responder=lambda body: (
                {"query": DEFAULT_QUERY}
                if body["messages"][0]["content"] == QUERY_AGENT_PROMPT
                else valid_forecast(events=[])
            ),
        )
        await run(upstream, profile=profile, excerpt="an excerpt")
        sent = json.dumps([call["body"] for call in upstream.calls]) + " ".join(upstream.page_calls)
        for secret in PERSONAL_DATA:
            assert secret not in sent, secret
        person = user_payload(upstream.calls[-1])["person"]
        assert person == {
            "sign": "Scorpio",
            "signKind": "rising",
            "focusAreas": ["career", "money"],
            "sunSign": "Libra",
            "moonSign": "Taurus",
            "risingSign": "Scorpio",
            "lifeContext": {
                "relationship": "dating",
                "work": "jobSeeking",
                "kids": ["under5"],
                "healthFocus": ["sleep"],
                "goals": "Find a product role by spring",
                "upcomingEvents": [{"date": "2026-11-16", "label": "Final interview"}],
            },
        }
    # The search query agent never sees the life context.
    query = user_payload(upstream.calls[0])
    assert set(query) == {"sign", "signKind", "month", "focusAreas"}
    assert "interview" not in json.dumps(upstream.calls[1]["body"])


async def test_life_context_is_not_written_to_the_profile_snapshot():
    deps = make_deps(Upstream(pages=source_pages(), nebius_outputs=[cited_forecast(CAFE_URL)]))
    await run_forecast_pipeline(profile_model(lifeContext=LIFE_CONTEXT), None, deps, lambda s: None)
    stored = profile_files(deps)[0].read_text()
    assert "lifeContext" not in stored and "interview" not in stored


async def test_general_mode_keeps_and_sends_only_the_sign():
    profile = {
        **VALID_PROFILE,
        "mode": "general",
        "sunSign": "Scorpio",
        "lifeContext": LIFE_CONTEXT,
    }
    upstream = Upstream(pages=source_pages(), nebius_outputs=[cited_forecast(CAFE_URL)])
    deps = make_deps(upstream)
    await run_forecast_pipeline(parse_profile(profile), None, deps, lambda s: None)
    assert json.loads(profile_files(deps)[0].read_text()) == {
        "mode": "general",
        "sunSign": "Scorpio",
        "targetMonth": "November 2026",
        "focusAreas": ["career", "money"],
    }
    assert user_payload(upstream.calls[0])["person"] == {
        "sign": "Scorpio",
        "signKind": "chosen",
        "focusAreas": ["career", "money"],
    }


async def test_user_sources_are_exclusive_and_a_gap_is_never_filled_silently():
    page_url = "https://my-astrologer.example/monthly"
    sources = {"user": [{"id": "u1", "url": page_url, "active": True}]}

    upstream = Upstream(pages=source_pages())  # the user's page is a 404
    steps: list[int] = []
    out = await run(upstream, sources=sources, steps=steps)
    assert upstream.calls == [], "no LLM call and no search without evidence"
    assert upstream.page_calls == [page_url], "curated sources are not touched"
    assert steps == [1, 2, 3, 4]
    assert out["evidence"] == {"mode": "user", "gap": True}
    assert out["result"]["events"] == []
    assert "None of your sources" in out["result"]["theme"]
    assert "END:VCALENDAR" in out["result"]["icsContent"]
    assert [(s["id"], s["origin"], s["status"]) for s in out["sources"]] == [
        ("u1", "user", "failed")
    ]

    pages = {**source_pages(), page_url: fixture("all_signs_page.html")}
    upstream = Upstream(pages=pages, nebius_outputs=[cited_forecast(page_url)])
    out = await run(upstream, sources=sources)
    assert upstream.services == ["nebius"]
    documents = user_payload(upstream.calls[0])["documents"]
    assert [d["url"] for d in documents] == [page_url]
    assert "Scorpio fixture text" in documents[0]["content"]
    assert "Libra fixture text" not in documents[0]["content"]
    assert out["evidence"] == {"mode": "user", "gap": False}

    # The explicit retry: the user's sources and the default ones together.
    upstream = Upstream(pages=source_pages(), nebius_outputs=[cited_forecast(CAFE_URL)])
    out = await run(upstream, sources={**sources, "includeCurated": True})
    assert out["evidence"] == {"mode": "curated", "gap": False}
    assert [s["status"] for s in out["sources"]] == ["failed"] + ["used"] * 5


async def test_a_bare_site_added_by_the_user_is_searched_with_include_domains():
    upstream = Upstream(
        tavily_results=[
            {"url": "https://blog.stars.example/nov", "title": "Nov", "content": "Nov 5 2026"},
        ],
        nebius_outputs=[cited_forecast("https://blog.stars.example/nov")],
    )
    sources = {
        "user": [
            {"url": "https://www.stars.example/"},
            {"url": "https://other.example"},
            {"url": "https://off.example", "active": False},
        ]
    }
    out = await run(upstream, sources=sources)
    assert upstream.services == ["tavily", "nebius"]
    search = upstream.calls[0]["body"]
    assert search["include_domains"] == ["stars.example", "other.example"]
    assert search["query"] == "Scorpio monthly horoscope November 2026 key dates"
    assert upstream.page_calls == []
    assert [(s["name"], s["status"]) for s in out["sources"]] == [
        ("stars.example", "used"),
        ("other.example", "no_forecast"),
    ]


async def test_disabled_curated_sources_are_skipped_and_one_source_triggers_the_web_fallback():
    disabled = ["rux-youtube", "cafe-astrology", "astrology-zone", "astrostyle"]
    upstream = Upstream(
        pages=source_pages(),
        nebius_outputs=[
            {"query": DEFAULT_QUERY},
            cited_forecast(SALLY_URL, "https://astro.example/nov-2026"),
        ],
    )
    out = await run(upstream, sources={"disabledCurated": disabled})
    assert upstream.services == ["nebius", "tavily", "nebius"]
    assert all("sallykirkman.com" in url for url in upstream.page_calls)
    assert out["evidence"] == {"mode": "web", "gap": False}
    assert [(s["id"], s["status"]) for s in out["sources"]] == [
        ("sally-kirkman", "used"),
        ("web-search", "used"),
    ]
    urls = [d["url"] for d in user_payload(upstream.calls[2])["documents"]]
    assert urls == [SALLY_URL, "https://astro.example/nov-2026", "https://sky.example/scorpio"]


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
    # Without an explicit limit the provider's default applies, which cut real forecasts off.
    assert query_call["body"]["max_tokens"] == upstream.calls[2]["body"]["max_tokens"] == 8000
    query_data = json.loads(query_call["body"]["messages"][1]["content"])
    assert query_data == {
        "sign": "Scorpio",
        "signKind": "rising",
        "month": {"firstDate": "2026-11-01", "lastDate": "2026-11-30", "label": "November 2026"},
        "focusAreas": ["Career & Work", "Money & Resources"],
    }

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
    assert len(forecast_data["documents"]) == 2
    assert forecast_data["documents"][0]["source"] == "astro.example"
    assert "profile" not in forecast_data and "customExcerpt" not in forecast_data
    assert out["evidence"] == {"mode": "web", "gap": False}
    assert out["sources"][-1]["id"] == "web-search"

    assert len(out["result"]["events"]) == 1
    assert "BEGIN:VCALENDAR" in out["result"]["icsContent"]
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
    assert [r["url"] for r in data["documents"]] == ["https://astro.example/nov-2026"]
    assert len(data["documents"][0]["title"]) == 300
    assert len(data["documents"][0]["content"]) == 12000


async def test_concurrent_same_profile_id_pipelines_each_use_their_own_snapshot():
    def respond(body):
        if body["messages"][0]["content"] == QUERY_AGENT_PROMPT:
            return {"query": "scoped query"}
        user = json.loads(body["messages"][1]["content"])
        day = user["month"]["firstDate"][:8] + "05"
        return valid_forecast(
            events=[valid_event(date=day, lifeAreas=[user["person"]["focusAreas"][0]])]
        )

    upstream = Upstream(responder=respond)
    deps = make_deps(upstream)
    shared_id = str(uuid.uuid4())
    december = profile_model(targetMonth="December 2026", focusAreas=["love"])

    out_a, out_b = await asyncio.gather(
        run_forecast_pipeline(profile_model(), None, deps, lambda s: None, shared_id),
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
    assert sorted(q["focusAreas"][0] for q in query_payloads) == [
        "Career & Work",
        "Love & Relationships",
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
            valid_forecast(events=[valid_event(sourceUrls=["https://fake.example/"])]),
        ],
        [{"query": "ok"}, valid_forecast(events=[valid_event(date="2027-11-05")])],
        [{"query": "ok"}, "just text"],
    ],
)
async def test_rejects_invalid_query_and_fabricated_forecast_fields(nebius_outputs):
    with pytest.raises(PipelineError) as error:
        await run(Upstream(nebius_outputs=nebius_outputs))
    assert error.value.status == 502


async def test_no_evidence_at_all_gives_an_honest_empty_result_without_a_forecast_call():
    upstream = Upstream(tavily_results=[], nebius_outputs=[{"query": "q"}])
    out = await run(upstream)
    assert upstream.services == ["nebius", "tavily"]
    assert out["result"]["events"] == []
    assert "No forecast for November 2026" in out["result"]["theme"]
    assert "END:VCALENDAR" in out["result"]["icsContent"]
    assert out["evidence"] == {"mode": "web", "gap": True}


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
            await run_forecast_pipeline(profile_model(), None, deps, lambda s: None)
        assert error.value.status == 502


async def test_missing_config_fails_after_the_profile_is_saved():
    deps = make_deps(env={})
    with pytest.raises(PipelineError) as error:
        await run_forecast_pipeline(profile_model(), None, deps, lambda s: None)
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


async def test_an_unparseable_or_cut_off_answer_is_asked_for_once_more():
    answers = [
        {"choices": [{"message": {"content": '{"theme": "cut'}, "finish_reason": "length"}]},
        {"choices": [{"message": {"content": json.dumps(cited_forecast(CAFE_URL))}}]},
    ]

    def scripted(replies):
        upstream = Upstream(pages=source_pages())
        original = upstream.__call__

        async def handler(request):
            if request.method == "GET":
                return await original(request)
            upstream.calls.append({"url": str(request.url)})
            return httpx.Response(200, json=replies[min(len(upstream.calls), len(replies)) - 1])

        deps = make_deps(upstream)
        deps.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return upstream, deps

    upstream, deps = scripted(answers)
    out = await run_forecast_pipeline(profile_model(), None, deps, lambda s: None)
    assert len(upstream.calls) == 2 and len(out["result"]["events"]) == 1

    upstream, deps = scripted(answers[:1])
    with pytest.raises(PipelineError, match="ran out of output tokens") as error:
        await run_forecast_pipeline(profile_model(), None, deps, lambda s: None)
    assert error.value.status == 502 and len(upstream.calls) == 2


async def test_events_get_ids_and_a_personal_note_only_with_a_life_context():
    noted = valid_forecast(
        events=[valid_event(sourceUrls=[CAFE_URL], personalNote="Prepare for your interview.")]
    )

    async def events_for(**profile):
        upstream = Upstream(pages=source_pages(), nebius_outputs=[noted])
        return (await run(upstream, profile={**VALID_PROFILE, **profile}))["result"]

    personal = await events_for(lifeContext=LIFE_CONTEXT)
    assert personal["events"][0]["personalNote"] == "Prepare for your interview."
    assert "For you: Prepare for your interview." in personal["icsContent"].replace("\r\n ", "")
    assert set(personal["events"][0]) == {
        "id",
        "date",
        "title",
        "type",
        "lifeAreas",
        "summary",
        "personalNote",
        "sourceUrls",
    }

    for profile in ({}, {"lifeContext": {"goals": " "}}, {"mode": "general", "sunSign": "Scorpio"}):
        result = await events_for(**profile)
        assert "personalNote" not in result["events"][0], profile
        assert "interview" not in result["icsContent"]
        assert result["events"][0]["id"] == personal["events"][0]["id"]
        assert f"UID:{result['events'][0]['id']}@moroscope" in result["icsContent"]
