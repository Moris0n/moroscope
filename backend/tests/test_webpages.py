import httpx
import pytest

from app.webpages import (
    MAX_PAGE_BYTES,
    XML_TYPES,
    NoForecast,
    SourceError,
    Target,
    astrology_zone,
    extract_links,
    fetch_page,
    generic_page,
    html_to_blocks,
    read_astrology_zone,
    read_astrostyle,
    read_cafe_astrology,
    read_generic_page,
    read_sally_kirkman,
    sally_kirkman,
)

from .helpers import AZ_SCORPIO_URL, SALLY_URL, Upstream, fixture, make_deps, source_pages

SCORPIO = Target("Scorpio", "November", 2026)
READERS = [
    (read_cafe_astrology, "cafe_astrology.html"),
    (read_astrology_zone, "astrology_zone_scorpio_1.html"),
    (read_astrostyle, "astrostyle_scorpio.html"),
    (read_sally_kirkman, "sally_kirkman_post.html"),
]


def test_html_to_blocks_keeps_headings_and_text_and_drops_page_furniture():
    title, blocks = html_to_blocks(fixture("cafe_astrology.html"))
    text = " ".join(b.text for b in blocks)
    assert title == "This Month in Astrology | Cafe Astrology .com"
    assert "script text" not in text and "Shop" not in text and "footer text" not in text
    assert [b.text for b in blocks if b.level == 1] == ["This Month in Astrology"]
    assert "Nov 9 | 2:02 AM | New Moon in Scorpio" in [b.text for b in blocks]
    assert all(b.main for b in blocks)

    _, messy = html_to_blocks("<p>one<br>two</p><div>three<nav>menu<nav>x</nav>y</nav>four")
    assert [b.text for b in messy] == ["one two", "three", "four"]


def test_target_names_the_month_only_together_with_its_year():
    assert SCORPIO.named_in("Horoscope for november, 2026")
    assert not SCORPIO.named_in("Horoscope for November 2025")
    assert not SCORPIO.named_in("Horoscope for November") and not SCORPIO.named_in("2026")


def test_cafe_astrology_is_cut_to_the_month_the_sign_and_the_timeline():
    text = read_cafe_astrology(fixture("cafe_astrology.html"), SCORPIO)
    assert text.startswith("## November 2026")
    assert "On November 9th, the New Moon" in text and "Full Moon in Gemini" in text
    assert "turning over a new leaf, fixture Scorpio" in text
    assert "Mars conjunct Jupiter (fixture timeline)" in text
    for other in ("Aries only", "Libra only", "Sagittarius only", "Ephemeris table", "October"):
        assert other not in text

    october = read_cafe_astrology(
        fixture("cafe_astrology.html"), Target("Scorpio", "October", 2026)
    )
    assert "Venus turns retrograde" in october and "relationships are a strong focus" in october
    assert "November" not in october


def test_each_site_reader_keeps_the_forecast_and_drops_the_rest():
    zone = read_astrology_zone(fixture("astrology_zone_scorpio_1.html"), SCORPIO)
    assert zone == "Fixture page 1 of the Scorpio forecast: watch Monday, November 11."

    twins = read_astrostyle(fixture("astrostyle_scorpio.html"), SCORPIO)
    assert twins.startswith("## Scorpio Monthly Horoscope November 2026")
    assert "Fixture retrograde paragraph." in twins
    assert "SUBSCRIBE" not in twins and "eighth sign" not in twins

    sally = read_sally_kirkman(fixture("sally_kirkman_post.html"), SCORPIO)
    assert "## Mercury Turns Direct" in sally and "fall on the 13th" in sally
    assert "join the circle" not in sally and "comment" not in sally


@pytest.mark.parametrize(("reader", "name"), READERS)
def test_site_readers_refuse_another_month_or_year(reader, name):
    for target in (Target("Scorpio", "December", 2026), Target("Scorpio", "November", 2027)):
        with pytest.raises(NoForecast):
            reader(fixture(name), target)


def test_generic_reader_checks_the_month_and_cuts_an_all_signs_page_to_the_sign():
    title, text = read_generic_page(fixture("all_signs_page.html"), SCORPIO)
    assert title == "Monthly horoscopes for every sign"
    assert "general fixture lead" in text and "Scorpio fixture text" in text
    assert "Libra fixture text" not in text and "Menu" not in text and "Sidebar" not in text
    with pytest.raises(NoForecast):
        read_generic_page(fixture("all_signs_page.html"), Target("Scorpio", "March", 2026))
    # A page about one sign is kept whole.
    _, single = read_generic_page(fixture("astrostyle_scorpio.html"), SCORPIO)
    assert "Fixture new moon paragraph." in single


async def test_astrology_zone_follows_the_index_link_and_reads_every_page_in_order():
    upstream = Upstream(pages=source_pages())
    [doc] = await astrology_zone(make_deps(upstream), SCORPIO)
    assert doc["url"] == AZ_SCORPIO_URL and doc["source"] == "Astrology Zone"
    assert [f"page {n} of" in doc["content"] for n in (1, 2, 3)] == [True] * 3
    assert doc["content"].index("page 1 of") < doc["content"].index("page 3 of")
    assert upstream.page_calls == [
        "https://www.astrologyzone.com/horoscopes/",
        AZ_SCORPIO_URL,
        f"{AZ_SCORPIO_URL}2/",
        f"{AZ_SCORPIO_URL}3/",
    ]

    # A missing later page keeps what was read; a missing sign link is an error.
    pages = {k: v for k, v in source_pages().items() if not k.endswith("/2/")}
    [partial] = await astrology_zone(make_deps(Upstream(pages=pages)), SCORPIO)
    assert "page 1 of" in partial["content"] and "page 3 of" not in partial["content"]
    with pytest.raises(SourceError):
        await astrology_zone(
            make_deps(Upstream(pages=source_pages())), Target("Leo", "November", 2026)
        )


async def test_sally_kirkman_follows_the_month_link_from_the_sign_page():
    [doc] = await sally_kirkman(make_deps(Upstream(pages=source_pages())), SCORPIO)
    assert doc["url"] == SALLY_URL and "fall on the 13th" in doc["content"]
    with pytest.raises(NoForecast):
        await sally_kirkman(
            make_deps(Upstream(pages=source_pages())), Target("Scorpio", "December", 2026)
        )


def test_extract_links_resolves_relative_addresses():
    html = "<a href=\"/a?x=1&amp;y=2\">a</a> <a href='b/'>b</a>"
    assert extract_links(html, "https://site.example/dir/") == [
        "https://site.example/a?x=1&y=2",
        "https://site.example/dir/b/",
    ]


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://localhost/",
        "http://[::1]/",
        "http://10.1.2.3/",
        "http://169.254.169.254/latest/meta-data/",
        "http://intranet.example/wiki",
        "https://site.example:8443/",
        "https://user:secret@site.example/",
        "ftp://site.example/file",
        "file:///etc/passwd",
    ],
)
async def test_fetch_refuses_private_and_unusual_addresses_without_any_request(url):
    upstream = Upstream()
    deps = make_deps(upstream)

    async def resolve(host):
        return {"localhost": ["127.0.0.1"], "intranet.example": ["10.0.0.5"]}.get(
            host, ["93.184.216.34"]
        )

    deps.resolve_host = resolve
    with pytest.raises(SourceError):
        await fetch_page(deps, url)
    assert upstream.page_calls == []


async def test_fetch_checks_every_redirect_hop():
    def redirect(location):
        return httpx.Response(302, headers={"location": location})

    pages = {
        "https://site.example/start": redirect("/moved"),
        "https://site.example/moved": "<p>arrived</p>",
        "https://site.example/evil": redirect("http://metadata.example/latest"),
        "https://site.example/loop": redirect("https://site.example/loop"),
    }
    upstream = Upstream(pages=pages)
    deps = make_deps(upstream)
    page = await fetch_page(deps, "https://site.example/start")
    assert (page.url, page.text) == ("https://site.example/moved", "<p>arrived</p>")

    with pytest.raises(SourceError, match="public website"):
        await fetch_page(deps, "https://site.example/evil")
    assert "http://metadata.example/latest" not in upstream.page_calls
    with pytest.raises(SourceError, match="too many times"):
        await fetch_page(deps, "https://site.example/loop")


async def test_fetch_limits_size_and_content_type_and_reports_http_errors():
    def typed(content_type, body=b"x"):
        return httpx.Response(200, content=body, headers={"content-type": content_type})

    pages = {
        "https://site.example/big": typed("text/html", b"x" * (MAX_PAGE_BYTES + 1)),
        "https://site.example/pdf": typed("application/pdf"),
        "https://site.example/feed": typed("text/xml; charset=utf-8", b"<feed/>"),
        "https://site.example/latin": typed(
            "text/html; charset=iso-8859-1", "café".encode("latin-1")
        ),
    }
    deps = make_deps(Upstream(pages=pages))
    with pytest.raises(SourceError, match="too large"):
        await fetch_page(deps, "https://site.example/big")
    with pytest.raises(SourceError, match="not a web page"):
        await fetch_page(deps, "https://site.example/pdf")
    with pytest.raises(SourceError, match="not a web page"):
        await fetch_page(deps, "https://site.example/feed")
    assert (await fetch_page(deps, "https://site.example/feed", accept=XML_TYPES)).text == "<feed/>"
    assert (await fetch_page(deps, "https://site.example/latin")).text == "café"
    with pytest.raises(SourceError, match="HTTP 404"):
        await fetch_page(deps, "https://site.example/missing")

    async def timeout(request):
        raise httpx.ReadTimeout("slow")

    deps.http = httpx.AsyncClient(transport=httpx.MockTransport(timeout))
    with pytest.raises(SourceError, match="too long"):
        await fetch_page(deps, "https://site.example/slow")


async def test_generic_page_names_the_document_after_its_site():
    url = "https://www.my-astrologer.example/monthly"
    deps = make_deps(Upstream(pages={url: fixture("all_signs_page.html")}))
    [doc] = await generic_page(deps, SCORPIO, url)
    assert (doc["url"], doc["source"]) == (url, "my-astrologer.example")
    assert doc["title"] == "Monthly horoscopes for every sign"
