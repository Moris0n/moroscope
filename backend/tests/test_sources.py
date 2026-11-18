from app.sources import (
    CURATED_SOURCES,
    FOUND_TTL_SECONDS,
    MAX_TOTAL_DOCUMENT_LENGTH,
    NOT_PUBLISHED_TTL_SECONDS,
    SourcesConfig,
    gather_documents,
    select_sources,
    trim_documents,
    validate_sources_config,
)
from app.webpages import MAX_DOCUMENT_LENGTH, Target

from .helpers import CAFE_URL, Upstream, fixture, make_deps, source_pages

SCORPIO = Target("Scorpio", "November", 2026)
ALL_IDS = [source.id for source in CURATED_SOURCES]


def config(value):
    errors, parsed = validate_sources_config(value)
    assert errors == []
    return parsed


def test_sources_config_defaults_and_cleaning():
    assert config(None) == SourcesConfig() == config({})
    parsed = config(
        {
            "disabledCurated": ["astrostyle", "gone-source"],
            "includeCurated": True,
            "user": [
                {"id": "a", "url": "https://www.site.example/monthly/", "active": True},
                {"id": "b", "url": "https://site.example/monthly"},  # the same page again
                {"id": "c", "url": "https://off.example/x", "active": False},
                {"url": "https://youtu.be/nov26AAAAAA"},
            ],
        }
    )
    assert parsed.disabled_curated == {"astrostyle"}
    assert parsed.include_curated is True
    assert parsed.user == (
        ("a", "https://www.site.example/monthly/"),
        ("https://youtu.be/nov26AAAAAA", "https://youtu.be/nov26AAAAAA"),
    )


def test_sources_config_rejects_malformed_input():
    for bad in [
        [],
        {"disabledCurated": "astrostyle"},
        {"disabledCurated": [1]},
        {"includeCurated": 1},
        {"user": {}},
        {"user": ["https://site.example"]},
        {"user": [{"url": "javascript:alert(1)"}]},
        {"user": [{"url": "https://site.example/" + "x" * 500}]},
        {"user": [{"url": "https://site.example", "id": 7}]},
        {"user": [{"url": "https://site.example", "active": "yes"}]},
        {"user": [{"url": f"https://s{i}.example"} for i in range(11)]},
    ]:
        errors, parsed = validate_sources_config(bad)
        assert errors and parsed is None, bad


def test_selection_user_sources_are_exclusive_unless_curated_ones_are_asked_for():
    exclusive, sources = select_sources(SourcesConfig())
    assert not exclusive and [s.id for s in sources] == ALL_IDS

    _, sources = select_sources(config({"disabledCurated": ["rux-youtube", "astrostyle"]}))
    assert [s.id for s in sources] == ["cafe-astrology", "astrology-zone", "sally-kirkman"]

    user = {
        "user": [
            {"id": "page", "url": "https://site.example/monthly"},
            {"id": "site", "url": "https://www.site.example/"},
            {"id": "tube", "url": "https://www.youtube.com/@someone"},
        ]
    }
    exclusive, sources = select_sources(config(user))
    assert exclusive and [(s.id, s.origin) for s in sources] == [
        ("page", "user"),
        ("site", "user"),
        ("tube", "user"),
    ]
    assert [s.domain for s in sources] == [None, "site.example", None]
    assert [s.read is None for s in sources] == [False, True, False]

    exclusive, sources = select_sources(config({**user, "includeCurated": True}))
    assert not exclusive and [s.id for s in sources] == ["page", "site", "tube", *ALL_IDS]


async def test_gather_reports_on_every_source_and_keeps_the_others_when_one_fails():
    pages = source_pages()
    del pages["https://astrostyle.com/horoscopes/monthly/scorpio/"]
    pages[CAFE_URL] = fixture("cafe_astrology.html").replace("November 2026", "March 2026")
    deps = make_deps(Upstream(pages=pages))
    gathered = await gather_documents(deps, select_sources(SourcesConfig())[1], SCORPIO)

    assert [(e["id"], e["status"], e["documents"]) for e in gathered.report] == [
        ("rux-youtube", "used", 2),
        ("cafe-astrology", "no_forecast", 0),
        ("astrology-zone", "used", 1),
        ("astrostyle", "failed", 0),
        ("sally-kirkman", "used", 1),
    ]
    assert gathered.used == 3 and len(gathered.documents) == 4
    assert gathered.report[1]["reason"] == "No forecast for November 2026 was found."
    assert gathered.report[3]["reason"] == "The site answered with HTTP 404."
    assert all(e["origin"] == "curated" and e["name"] and e["url"] for e in gathered.report)


async def test_found_forecasts_are_cached_for_a_week_and_misses_for_six_hours():
    clock = [1_000_000.0]
    pages = source_pages()
    cafe = pages.pop(CAFE_URL)
    upstream = Upstream(pages=pages)
    deps = make_deps(upstream)
    deps.now = lambda: clock[0]
    sources = [
        s for s in select_sources(SourcesConfig())[1] if s.id in ("cafe-astrology", "astrostyle")
    ]

    async def statuses(target=SCORPIO):
        upstream.page_calls.clear()
        gathered = await gather_documents(deps, sources, target)
        return [e["status"] for e in gathered.report], len(upstream.page_calls)

    assert await statuses() == (["failed", "used"], 2)
    assert await statuses() == (["failed", "used"], 1), "failures are retried, hits are cached"

    pages[CAFE_URL] = cafe.replace("November 2026", "March 2026")
    assert await statuses() == (["no_forecast", "used"], 1)
    pages[CAFE_URL] = cafe  # published in the meantime
    assert await statuses() == (["no_forecast", "used"], 0), "a miss is remembered"
    clock[0] += NOT_PUBLISHED_TTL_SECONDS + 1
    assert await statuses() == (["used", "used"], 1)

    clock[0] += FOUND_TTL_SECONDS - NOT_PUBLISHED_TTL_SECONDS
    assert (await statuses())[1] == 1, "astrostyle expired, cafe astrology has not"
    # Another sign or month is a different cache entry.
    assert (await statuses(Target("Leo", "November", 2026)))[1] == 2
    assert all(p.suffix == ".json" for p in (deps.data_dir / "cache" / "sources").iterdir())


def test_trim_documents_fits_the_prompt_budget_by_shortening_the_longest():
    def doc(url, size):
        return {"url": url, "source": "s", "title": "t", "content": "x" * size}

    small = [doc("https://a.example/1", 100), doc("https://a.example/2", 200)]
    assert trim_documents(small) == small
    assert trim_documents([*small, doc("https://a.example/1", 999)]) == small

    big = [doc(f"https://a.example/{i}", 50000 if i < 3 else 6000) for i in range(5)]
    trimmed = trim_documents(big)
    sizes = [len(d["content"]) for d in trimmed]
    assert sum(sizes) == MAX_TOTAL_DOCUMENT_LENGTH and max(sizes) <= MAX_DOCUMENT_LENGTH
    assert sizes[3:] == [6000, 6000], "short documents are left alone"
    assert len(big[0]["content"]) == 50000, "the input is not modified"
