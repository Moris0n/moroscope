import asyncio
import json
import re
import uuid

import httpx
import pytest

from app.config import PipelineError, load_agent_config, load_allowed_hosts
from app.models import parse_profile
from app.pipeline import run_forecast_pipeline
from app.prompts import EXTRACTOR_PROMPT, QUERY_AGENT_PROMPT, SYNTHESIZER_PROMPT
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
    auto_extraction,
    auto_synthesis,
    extracted_event,
    fixture,
    make_deps,
    profile_files,
    profile_model,
    source_pages,
)

ALL_STEPS = [1, 2, 3, 4, 5]
MONTH = {"firstDate": "2026-11-01", "lastDate": "2026-11-30", "label": "November 2026"}
WEB_URL = "https://astro.example/nov-2026"


async def run(
    upstream,
    profile=VALID_PROFILE,
    excerpt=None,
    profile_id=None,
    steps=None,
    sources=None,
    deps=None,
):
    on_step = steps.append if steps is not None else (lambda step: None)
    config = None
    if sources is not None:
        errors, config = validate_sources_config(sources)
        assert errors == []
    return await run_forecast_pipeline(
        parse_profile(profile), excerpt, deps or make_deps(upstream), on_step, profile_id, config
    )


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
# What the life context above becomes: the only description of the user that leaves the server.
NARRATIVE = (
    "First priority: Career & Work (looking for a job). Second: Money & Resources. "
    "Third: Love & Relationships (dating). Fourth: Family & Home (a child under 5). "
    "Fifth: Health & Wellbeing (health focus: sleep). "
    'Stated goal, in the user\'s words: "Find a product role by spring".'
)


def by_source(**answers):
    """An Extractor that answers per document source; other documents have no events."""

    def extractor(payload):
        return {"events": answers.get(payload["document"]["source"].split(".")[0], [])}

    return extractor


async def test_curated_sources_are_read_directly_and_each_document_is_extracted_on_its_own():
    upstream = Upstream(pages=source_pages())
    steps: list[int] = []
    out = await run(upstream, steps=steps)

    assert upstream.services == ["extract"] * 5 + ["synthesize"]
    assert steps == ALL_STEPS
    call = upstream.calls[0]
    assert call["url"] == "https://nebius.test/v1/chat/completions"
    assert call["headers"]["authorization"] == "Bearer test-nebius-key"
    assert call["body"]["model"] == "test-model"
    assert call["body"]["messages"][0] == {"role": "system", "content": EXTRACTOR_PROMPT}
    assert call["body"]["response_format"] == {"type": "json_object"}
    # Without an explicit limit the provider's default applies, which cut real forecasts off.
    assert {c["body"]["max_tokens"] for c in upstream.calls} == {8000}

    payloads = upstream.extractor_payloads
    for payload in payloads:
        assert set(payload) == {"month", "sign", "document"}
        assert payload["month"] == MONTH and payload["sign"] == "Scorpio"
        assert set(payload["document"]) == {"source", "title", "content"}
    contents = [payload["document"]["content"] for payload in payloads]
    assert "my dear scorpios on the 13th of november mercury and venus turn direct" in contents
    assert any("page 3 of the Scorpio forecast" in content for content in contents)
    cafe = next(c for c in contents if "New Moon occurs" in c)
    assert "Libra" not in cafe and "October" not in cafe

    assert out["evidence"] == {"mode": "curated", "gap": False}
    assert [(s["id"], s["status"], s["events"], s["dropped"]) for s in out["sources"]] == [
        ("rux-youtube", "used", 1, 0),
        ("cafe-astrology", "used", 1, 0),
        ("astrology-zone", "used", 1, 0),
        ("astrostyle", "used", 1, 0),
        ("sally-kirkman", "used", 1, 0),
    ]
    events = out["result"]["events"]
    assert sorted(url for event in events for url in event["sourceUrls"]) == sorted(
        [RUX_SCORPIO_URL, CAFE_URL, AZ_SCORPIO_URL, ASTROSTYLE_URL, SALLY_URL]
    )
    assert [event["date"] for event in events] == sorted(event["date"] for event in events)
    assert all(event["title"].startswith("Synth: ") for event in events)
    assert out["result"]["icsContent"].count("BEGIN:VEVENT") == 5
    assert re.match(UUID_PATTERN, out["profileId"])


async def test_the_synthesizer_gets_the_verified_events_and_no_source_text():
    upstream = Upstream(pages=source_pages())
    await run(
        upstream, profile={**VALID_PROFILE, "lifeContext": LIFE_CONTEXT}, excerpt="an excerpt"
    )

    [call] = [
        c for c in upstream.calls if c["body"]["messages"][0]["content"] == SYNTHESIZER_PROMPT
    ]
    [payload] = upstream.synthesizer_payloads
    assert set(payload) == {
        "month",
        "sign",
        "priorities",
        "upcomingEvents",
        "events",
        "customExcerpt",
    }
    assert payload["month"] == MONTH and payload["sign"] == "Scorpio"
    assert payload["priorities"] == NARRATIVE
    assert payload["upcomingEvents"] == [{"date": "2026-11-16", "label": "Final interview"}]
    assert payload["customExcerpt"] == "an excerpt"
    assert len(payload["events"]) == 5
    for event in payload["events"]:
        assert set(event) == {
            "id",
            "date",
            "type",
            "lifeAreas",
            "title",
            "advice",
            "source",
            "inFocus",
            "priority",
        }
        assert event["inFocus"] is True and event["priority"] == 1  # all tagged "career"
    sent = json.dumps(call["body"])
    for extraction in upstream.extractor_payloads:
        assert extraction["document"]["content"] not in sent
    for source_text in ("fixture", "my dear scorpios", "turn direct", "New Moon occurs"):
        assert source_text not in sent, source_text


async def test_no_name_birth_data_or_life_context_reaches_the_extractor_or_the_search():
    profile = {**VALID_PROFILE, "lifeContext": LIFE_CONTEXT}
    for pages in (source_pages(), {}):  # the direct path and the web-search fallback
        upstream = Upstream(pages=pages)
        await run(upstream, profile=profile, excerpt="an excerpt")
        sent = json.dumps([call["body"] for call in upstream.calls]) + " ".join(upstream.page_calls)
        for secret in PERSONAL_DATA:
            assert secret not in sent, secret
        # The Extractor, the query agent and the search learn nothing about the user's life.
        impersonal = json.dumps(
            [
                call["body"]["messages"][1] if "messages" in call["body"] else call["body"]
                for call, service in zip(upstream.calls, upstream.services)
                if service != "synthesize"
            ]
        )
        for private in ("interview", "product role", "dating", "job", "child", "sleep", "excerpt"):
            assert private not in impersonal, private
        assert upstream.synthesizer_payloads[0]["priorities"] == NARRATIVE
    # The search query agent gets the sign, the month and the focus areas only.
    query = json.loads(upstream.calls[0]["body"]["messages"][1]["content"])
    assert query == {
        "sign": "Scorpio",
        "signKind": "rising",
        "month": MONTH,
        "focusAreas": ["Career & Work", "Money & Resources"],
    }


async def test_life_context_is_not_written_to_the_profile_snapshot_or_the_extraction_cache():
    deps = make_deps(Upstream(pages=source_pages()))
    await run_forecast_pipeline(profile_model(lifeContext=LIFE_CONTEXT), None, deps, lambda s: None)
    stored = profile_files(deps)[0].read_text()
    assert "lifeContext" not in stored and "interview" not in stored
    cached = list((deps.data_dir / "cache" / "extractions").iterdir())
    assert len(cached) == 5
    for path in cached:
        text = path.read_text()
        assert "interview" not in text and "product role" not in text and "Test User" not in text


async def test_general_mode_keeps_and_sends_only_the_sign_and_the_focus_areas():
    profile = {
        **VALID_PROFILE,
        "mode": "general",
        "sunSign": "Scorpio",
        "lifeContext": LIFE_CONTEXT,
    }
    upstream = Upstream(pages=source_pages())
    deps = make_deps(upstream)
    await run_forecast_pipeline(parse_profile(profile), None, deps, lambda s: None)
    assert json.loads(profile_files(deps)[0].read_text()) == {
        "mode": "general",
        "sunSign": "Scorpio",
        "targetMonth": "November 2026",
        "focusAreas": ["career", "money"],
    }
    [payload] = upstream.synthesizer_payloads
    assert set(payload) == {"month", "sign", "priorities", "events"}
    assert payload["sign"] == "Scorpio"
    assert payload["priorities"] == "First priority: Career & Work. Second: Money & Resources."


async def test_user_sources_are_exclusive_and_a_gap_is_never_filled_silently():
    page_url = "https://my-astrologer.example/monthly"
    sources = {"user": [{"id": "u1", "url": page_url, "active": True}]}

    upstream = Upstream(pages=source_pages())  # the user's page is a 404
    steps: list[int] = []
    out = await run(upstream, sources=sources, steps=steps)
    assert upstream.calls == [], "no LLM call and no search without evidence"
    assert upstream.page_calls == [page_url], "curated sources are not touched"
    assert steps == ALL_STEPS
    assert out["evidence"] == {"mode": "user", "gap": True}
    assert out["result"]["events"] == []
    assert "None of your sources" in out["result"]["theme"]
    assert "END:VCALENDAR" in out["result"]["icsContent"]
    assert [(s["id"], s["origin"], s["status"]) for s in out["sources"]] == [
        ("u1", "user", "failed")
    ]
    assert "events" not in out["sources"][0]

    pages = {**source_pages(), page_url: fixture("all_signs_page.html")}
    upstream = Upstream(pages=pages)
    out = await run(upstream, sources=sources)
    assert upstream.services == ["extract", "synthesize"]
    [payload] = upstream.extractor_payloads
    assert "Scorpio fixture text" in payload["document"]["content"]
    assert "Libra fixture text" not in payload["document"]["content"]
    assert out["evidence"] == {"mode": "user", "gap": False}
    assert out["result"]["events"][0]["sourceUrls"] == [page_url]

    # The explicit retry: the user's sources and the default ones together.
    upstream = Upstream(pages=source_pages())
    out = await run(upstream, sources={**sources, "includeCurated": True})
    assert out["evidence"] == {"mode": "curated", "gap": False}
    assert [s["status"] for s in out["sources"]] == ["failed"] + ["used"] * 5


async def test_a_bare_site_added_by_the_user_is_searched_with_include_domains():
    upstream = Upstream(
        tavily_results=[
            {
                "url": "https://blog.stars.example/nov",
                "title": "Nov",
                "content": "Mars ingress on Nov 5 2026",
            },
        ],
    )
    sources = {
        "user": [
            {"url": "https://www.stars.example/"},
            {"url": "https://other.example"},
            {"url": "https://off.example", "active": False},
        ]
    }
    out = await run(upstream, sources=sources)
    assert upstream.services == ["tavily", "extract", "synthesize"]
    search = upstream.calls[0]["body"]
    assert search["include_domains"] == ["stars.example", "other.example"]
    assert search["query"] == "Scorpio monthly horoscope November 2026 key dates"
    assert upstream.page_calls == []
    assert [(s["name"], s["status"], s.get("events")) for s in out["sources"]] == [
        ("stars.example", "used", 1),
        ("other.example", "no_forecast", None),
    ]


async def test_disabled_curated_sources_are_skipped_and_one_source_triggers_the_web_fallback():
    disabled = ["rux-youtube", "cafe-astrology", "astrology-zone", "astrostyle"]
    upstream = Upstream(pages=source_pages())
    out = await run(upstream, sources={"disabledCurated": disabled})
    assert upstream.services == ["query", "tavily"] + ["extract"] * 3 + ["synthesize"]
    assert all("sallykirkman.com" in url for url in upstream.page_calls)
    assert out["evidence"] == {"mode": "web", "gap": False}
    assert [(s["id"], s["status"], s["events"]) for s in out["sources"]] == [
        ("sally-kirkman", "used", 1),
        ("web-search", "used", 2),
    ]
    sources = {p["document"]["source"] for p in upstream.extractor_payloads}
    assert {"astro.example", "sky.example"} < sources and len(sources) == 3


async def test_the_web_fallback_calls_the_query_agent_the_search_the_extractor_and_the_synthesizer():
    upstream = Upstream()
    steps: list[int] = []
    out = await run(upstream, steps=steps)

    assert upstream.services == ["query", "tavily", "extract", "extract", "synthesize"]
    assert steps == ALL_STEPS

    query_call = upstream.calls[0]
    assert query_call["body"]["messages"][0] == {"role": "system", "content": QUERY_AGENT_PROMPT}
    assert json.loads(query_call["body"]["messages"][1]["content"]) == {
        "sign": "Scorpio",
        "signKind": "rising",
        "month": MONTH,
        "focusAreas": ["Career & Work", "Money & Resources"],
    }
    assert upstream.calls[1]["body"] == {
        "api_key": "test-tavily-key",
        "query": DEFAULT_QUERY,
        "search_depth": "advanced",
        "max_results": 10,
        "include_answer": False,
        "include_raw_content": False,
    }
    # The extractions run side by side, so their order is not fixed.
    assert sorted(p["document"]["source"] for p in upstream.extractor_payloads) == [
        "astro.example",
        "sky.example",
    ]
    [payload] = upstream.synthesizer_payloads
    assert "customExcerpt" not in payload and "upcomingEvents" not in payload
    assert out["evidence"] == {"mode": "web", "gap": False}
    assert out["sources"][-1]["id"] == "web-search" and out["sources"][-1]["events"] == 2

    assert [e["date"] for e in out["result"]["events"]] == ["2026-11-05", "2026-11-12"]
    assert "BEGIN:VCALENDAR" in out["result"]["icsContent"]
    assert re.match(UUID_PATTERN, out["profileId"])


async def test_custom_excerpt_is_bounded_and_search_results_are_sanitized():
    upstream = Upstream(
        tavily_results=[
            {"url": WEB_URL, "title": "t" * 500, "content": "Mars ingress on Nov 5 " + "c" * 20000},
            {"url": "javascript:alert(1)", "title": "bad scheme"},
            "not an object",
        ]
    )
    await run(upstream, excerpt="e" * 9000)
    [extraction] = upstream.extractor_payloads
    assert "customExcerpt" not in extraction, "the pasted text never reaches the Extractor"
    assert extraction["document"]["source"] == "astro.example"
    assert len(extraction["document"]["title"]) == 300
    assert len(extraction["document"]["content"]) == 12000
    assert len(upstream.synthesizer_payloads[0]["customExcerpt"]) == 8000


async def test_concurrent_same_profile_id_pipelines_each_use_their_own_snapshot():
    def tavily_month_agnostic(payload):
        # One event on the 5th of whatever month was asked for.
        day = payload["month"]["firstDate"][:8] + "05"
        return {"events": [extracted_event(date=day)]}

    upstream = Upstream(query={"query": "scoped query"}, extractor=tavily_month_agnostic)
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
    assert out_a["result"]["events"][0]["inFocus"] is True
    assert out_b["result"]["events"][0]["inFocus"] is False

    query_payloads = [
        json.loads(call["body"]["messages"][1]["content"])
        for call, service in zip(upstream.calls, upstream.services)
        if service == "query"
    ]
    assert sorted(q["month"]["firstDate"] for q in query_payloads) == ["2026-11-01", "2026-12-01"]
    assert sorted(q["focusAreas"][0] for q in query_payloads) == [
        "Career & Work",
        "Love & Relationships",
    ]
    assert sorted(p["priorities"] for p in upstream.synthesizer_payloads) == [
        "First priority: Career & Work. Second: Money & Resources.",
        "First priority: Love & Relationships.",
    ]
    assert [p.name for p in profile_files(deps)] == [f"{shared_id}.json"]


@pytest.mark.parametrize(
    "script",
    [
        {"query": {"query": "x" * 400}},
        {"query": {"query": "   "}},
        {"query": ["not", "an", "object"]},
        {"extractor": "just text"},
        {"extractor": {"events": "none"}},
        {"extractor": {"dated": []}},
        {"synthesizer": "just text"},
        {"synthesizer": {"groups": []}},
        {"synthesizer": {"theme": " ", "groups": []}},
        {"synthesizer": {"theme": "t", "groups": "none"}},
    ],
)
async def test_an_invalid_query_extraction_of_every_document_or_synthesis_is_a_502(script):
    with pytest.raises(PipelineError) as error:
        await run(Upstream(**script))
    assert error.value.status == 502


async def test_an_event_that_fails_the_check_is_dropped_and_counted_not_the_forecast():
    extractor = by_source(
        astro=[
            extracted_event(),
            extracted_event(quote="Jupiter turns retrograde on Nov 5"),  # not in the document
            extracted_event(date="2026-11-06"),  # the quote names the 5th
            extracted_event(date="2026-12-05"),  # another month
            extracted_event(tone="Doom"),
            "not an object",
        ],
        sky=[extracted_event(date="2026-11-20", quote="Venus transit Nov 12-14")],
    )
    upstream = Upstream(extractor=extractor)
    out = await run(upstream)
    assert [e["id"] for e in upstream.synthesizer_payloads[0]["events"]] == [
        e["id"] for e in out["result"]["events"]
    ]
    [event] = out["result"]["events"]
    assert (event["date"], event["sourceUrls"]) == ("2026-11-05", [WEB_URL])
    assert out["sources"][-1] == {
        "id": "web-search",
        "name": "Web search",
        "url": "",
        "origin": "web",
        "status": "used",
        "documents": 2,
        "events": 1,
        "dropped": 6,
    }


async def test_one_source_failing_extraction_is_reported_and_the_others_continue():
    def extractor(payload):
        if "AstroTwins" in payload["document"]["content"]:
            return "no json here"
        return auto_extraction(payload)

    upstream = Upstream(pages=source_pages(), extractor=extractor)
    out = await run(upstream)
    assert upstream.services.count("extract") == 5
    report = {s["id"]: s for s in out["sources"]}
    assert report["astrostyle"]["status"] == "failed"
    assert (
        report["astrostyle"]["reason"] == "The dated events could not be extracted from its text."
    )
    assert (report["astrostyle"]["events"], report["astrostyle"]["documents"]) == (0, 1)
    assert [s["status"] for s in out["sources"]].count("used") == 4
    assert len(out["result"]["events"]) == 4
    assert ASTROSTYLE_URL not in json.dumps(out["result"])


async def test_extractions_are_cached_per_document_sign_month_model_and_prompt():
    upstream = Upstream()
    deps = make_deps(upstream)
    first = await run(upstream, deps=deps)
    assert upstream.services.count("extract") == 2

    # Another person, same sign and month: nothing is extracted again, and the ids are the same.
    other = {**VALID_PROFILE, "name": "Someone Else", "focusAreas": ["love"]}
    second = await run(upstream, profile=other, deps=deps)
    assert upstream.services.count("extract") == 2
    assert upstream.services.count("synthesize") == 2
    assert [e["id"] for e in second["result"]["events"]] == [
        e["id"] for e in first["result"]["events"]
    ]

    # A different month, sign or model is a different extraction.
    await run(upstream, profile={**VALID_PROFILE, "targetMonth": "December 2026"}, deps=deps)
    assert upstream.services.count("extract") == 4
    await run(upstream, profile={**VALID_PROFILE, "risingSign": "Leo"}, deps=deps)
    assert upstream.services.count("extract") == 6
    deps.env = {**FULL_ENV, "NEBIUS_MODEL": "another-model"}
    await run(upstream, deps=deps)
    assert upstream.services.count("extract") == 8

    # A changed document is extracted again; an unusable answer is never cached.
    changed = [
        {"url": WEB_URL, "title": "Nov forecast", "content": "Mars ingress on Nov 5, updated"}
    ]
    upstream = Upstream(tavily_results=changed, extractor="broken")
    upstream_deps = make_deps(upstream)
    with pytest.raises(PipelineError):
        await run(upstream, deps=upstream_deps)
    assert not (upstream_deps.data_dir / "cache" / "extractions").exists()


async def test_no_evidence_at_all_gives_an_honest_empty_result_without_extraction():
    upstream = Upstream(tavily_results=[], query={"query": "q"})
    steps: list[int] = []
    out = await run(upstream, steps=steps)
    assert upstream.services == ["query", "tavily"]
    assert steps == ALL_STEPS
    assert out["result"]["events"] == []
    assert "No forecast for November 2026" in out["result"]["theme"]
    assert "END:VCALENDAR" in out["result"]["icsContent"]
    assert out["evidence"] == {"mode": "web", "gap": True}


async def test_no_verified_event_gives_an_honest_empty_result_without_a_synthesizer_call():
    upstream = Upstream(extractor={"events": [extracted_event(quote="made up on November 5")]})
    steps: list[int] = []
    out = await run(upstream, steps=steps)
    assert upstream.services == ["query", "tavily", "extract", "extract"]
    assert steps == ALL_STEPS
    assert out["result"]["events"] == []
    assert "no dated event in them could be confirmed" in out["result"]["theme"]
    assert out["evidence"] == {"mode": "web", "gap": False}
    assert (out["sources"][-1]["events"], out["sources"][-1]["dropped"]) == (0, 2)


@pytest.mark.parametrize(
    ("upstream", "status"),
    [
        (Upstream(nebius_status=500), 502),
        (Upstream(nebius_error=httpx.ConnectError("refused")), 502),
        (Upstream(nebius_error=httpx.ReadTimeout("slow")), 504),
        (Upstream(pages=source_pages(), nebius_status=500), 502),
        (Upstream(pages=source_pages(), nebius_error=httpx.ReadTimeout("slow")), 504),
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
    cut_off = httpx.Response(
        200,
        json={"choices": [{"message": {"content": '{"theme": "cut'}, "finish_reason": "length"}]},
    )

    def scripted(always_cut_off):
        answers = 0

        def synthesizer(payload):
            nonlocal answers
            answers += 1
            return cut_off if always_cut_off or answers == 1 else auto_synthesis(payload)

        return Upstream(
            pages={ASTROSTYLE_URL: fixture("astrostyle_scorpio.html")}, synthesizer=synthesizer
        )

    sources = {"user": [{"url": ASTROSTYLE_URL}]}
    upstream = scripted(False)
    out = await run(upstream, sources=sources)
    assert upstream.services == ["extract", "synthesize", "synthesize"]
    assert len(out["result"]["events"]) == 1

    upstream = scripted(True)
    with pytest.raises(PipelineError, match="ran out of output tokens") as error:
        await run(upstream, sources=sources)
    assert error.value.status == 502 and upstream.services.count("synthesize") == 2


async def test_events_get_stable_ids_and_a_personal_note_only_with_a_life_context():
    def noted(payload):
        answer = auto_synthesis(payload)
        answer["groups"][0]["personalNote"] = "Prepare for your interview."
        return answer

    async def result_for(**profile):
        upstream = Upstream(synthesizer=noted)
        return (await run(upstream, profile={**VALID_PROFILE, **profile}))["result"]

    personal = await result_for(lifeContext=LIFE_CONTEXT)
    first = personal["events"][0]
    assert first["personalNote"] == "Prepare for your interview."
    assert "For you: Prepare for your interview." in personal["icsContent"].replace("\r\n ", "")
    assert set(first) == {
        "id",
        "date",
        "title",
        "type",
        "lifeAreas",
        "summary",
        "personalNote",
        "sourceUrls",
        "inFocus",
    }
    assert re.fullmatch(r"[0-9a-f]{12}", first["id"])
    assert "personalNote" not in personal["events"][1]

    for profile in ({}, {"lifeContext": {"goals": " "}}, {"mode": "general", "sunSign": "Scorpio"}):
        result = await result_for(**profile)
        assert "personalNote" not in result["events"][0], profile
        assert "interview" not in result["icsContent"]
        assert result["events"][0]["id"] == first["id"]
        assert f"UID:{first['id']}@moroscope" in result["icsContent"]
