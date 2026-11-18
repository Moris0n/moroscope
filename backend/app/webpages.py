"""Reading astrology web pages: safe fetching, HTML to text, and one adapter per curated site."""

from __future__ import annotations

import asyncio
import ipaddress
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from .config import PipelineDeps
from .validation import MONTH_NAMES, ZODIAC_ORDER

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
FETCH_TIMEOUT_SECONDS = 20.0
MAX_PAGE_BYTES = 3 * 1024 * 1024
MAX_REDIRECTS = 5
MAX_DOCUMENT_LENGTH = 30000
MAX_PAGINATED_PAGES = 12
HTML_TYPES = ("text/html", "application/xhtml+xml")
XML_TYPES = ("application/xml", "text/xml", "application/atom+xml", "application/rss+xml")

_SKIPPED_TAGS = frozenset(
    {"script", "style", "noscript", "svg", "nav", "footer", "aside", "form", "template"}
    | {"iframe", "button", "select", "textarea"}
)
_BLOCK_TAGS = frozenset(
    {"p", "div", "li", "ul", "ol", "tr", "table", "section", "article", "main", "blockquote"}
    | {"header", "figure", "figcaption", "dl", "dt", "dd", "pre", "hr", "title"}
)
_HEADING_TAGS = {f"h{level}": level for level in range(1, 7)}
_MAIN_TAGS = frozenset({"article", "main"})
_ANY_MONTH = "|".join(MONTH_NAMES)
_HREF_RE = re.compile(r"""href\s*=\s*["']([^"'<>\s]+)["']""", re.IGNORECASE)


class SourceError(Exception):
    """A source could not be read; `reason` is safe to show to the user."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class NoForecast(Exception):
    """The source was read but holds no forecast for the requested month and sign."""


@dataclass(frozen=True)
class Target:
    sign: str  # "Scorpio"
    month: str  # "November"
    year: int

    @property
    def label(self) -> str:
        return f"{self.month} {self.year}"

    def named_in(self, text: str) -> bool:
        """True if the text names the target month together with its year."""
        return bool(re.search(rf"\b{self.month},?\s+{self.year}\b", text, re.IGNORECASE))


@dataclass(frozen=True)
class Page:
    url: str  # after redirects
    text: str


@dataclass(frozen=True)
class Block:
    level: int  # 1 to 6 for headings, 0 for other text
    text: str
    main: bool = False  # inside <article> or <main>


def document(url: str, source: str, title: str, content: str) -> dict[str, str]:
    return {
        "url": url,
        "source": source,
        "title": title[:300],
        "content": content[:MAX_DOCUMENT_LENGTH],
    }


# --- fetching -------------------------------------------------------------------------------


async def _system_resolve(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, None)
    return [info[4][0] for info in infos]


async def check_public_url(deps: PipelineDeps, url: str) -> None:
    """Refuse anything but plain http(s) URLs on hosts that resolve to public addresses only."""
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError:
        raise SourceError("The address is not a valid URL.") from None
    if parts.scheme not in ("http", "https") or not host or parts.username or parts.password:
        raise SourceError("The address is not a plain http(s) URL.")
    if port not in (None, 80, 443):
        raise SourceError("The address uses a port that is not allowed.")
    try:
        addresses = [str(ipaddress.ip_address(host))]
    except ValueError:
        try:
            addresses = await (deps.resolve_host or _system_resolve)(host)
        except OSError:
            raise SourceError("The site could not be found.") from None
    if not addresses or not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses):
        raise SourceError("The address does not point to a public website.")


async def fetch_page(
    deps: PipelineDeps,
    url: str,
    accept: tuple[str, ...] = HTML_TYPES,
    headers: dict[str, str] | None = None,
) -> Page:
    """GET a public page as text; every redirect hop is checked like the first URL."""
    request_headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
    request_headers.update(headers or {})
    for _ in range(MAX_REDIRECTS + 1):
        await check_public_url(deps, url)
        try:
            async with deps.http.stream(
                "GET",
                url,
                headers=request_headers,
                timeout=FETCH_TIMEOUT_SECONDS,
                follow_redirects=False,
            ) as response:
                if response.is_redirect and response.headers.get("location"):
                    url = urljoin(url, response.headers["location"])
                    continue
                if not response.is_success:
                    raise SourceError(f"The site answered with HTTP {response.status_code}.")
                content_type = response.headers.get("content-type", "").split(";")[0].strip()
                if content_type.lower() not in accept:
                    raise SourceError("The address is not a web page.")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_PAGE_BYTES:
                        raise SourceError("The page is too large.")
                encoding = response.charset_encoding or "utf-8"
        except httpx.TimeoutException:
            raise SourceError("The site took too long to answer.") from None
        except httpx.HTTPError:
            raise SourceError("The site could not be reached.") from None
        try:
            return Page(url, body.decode(encoding, errors="replace"))
        except LookupError:
            return Page(url, body.decode("utf-8", errors="replace"))
    raise SourceError("The site redirected too many times.")


# --- HTML to text ---------------------------------------------------------------------------


class _BlockParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self.title = ""
        self._parts: list[str] = []
        self._skip: list[str] = []
        self._level = 0
        self._main = 0
        self._in_title = False

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._parts)).strip(" |")
        self._parts = []
        if not text:
            return
        if self._in_title:
            self.title = self.title or text
        else:
            self.blocks.append(Block(self._level, text, self._main > 0))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip:
            if tag == self._skip[0]:
                self._skip.append(tag)
            return
        if tag in _SKIPPED_TAGS:
            self._flush()
            self._skip.append(tag)
        elif tag in _HEADING_TAGS:
            self._flush()
            self._level = _HEADING_TAGS[tag]
        elif tag in _BLOCK_TAGS:
            self._flush()
            self._in_title = tag == "title"
            if tag in _MAIN_TAGS:
                self._main += 1
        elif tag == "br":
            self._parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self._skip:
            if tag == self._skip[0]:
                self._skip.pop()
            return
        if tag in _HEADING_TAGS:
            self._flush()
            self._level = 0
        elif tag in _BLOCK_TAGS:
            self._flush()
            self._in_title = False
            if tag in _MAIN_TAGS and self._main:
                self._main -= 1
        elif tag in ("td", "th"):
            self._parts.append(" | ")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self._parts.append(data)


def html_to_blocks(html: str) -> tuple[str, list[Block]]:
    """Return (page title, headings and paragraphs in order) without menus, scripts or forms."""
    parser = _BlockParser()
    parser.feed(html)
    parser.close()
    parser._flush()
    return parser.title, parser.blocks


def extract_links(html: str, base_url: str) -> list[str]:
    return [urljoin(base_url, href.replace("&amp;", "&")) for href in _HREF_RE.findall(html)]


def blocks_text(blocks: list[Block]) -> str:
    return "\n\n".join(f"## {b.text}" if b.level else b.text for b in blocks)


def find_heading(blocks: list[Block], pattern: str, start: int = 0) -> int | None:
    regex = re.compile(pattern, re.IGNORECASE)
    for index in range(start, len(blocks)):
        if blocks[index].level and regex.search(blocks[index].text):
            return index
    return None


def section(blocks: list[Block], start: int, stop: str | None = None) -> list[Block]:
    """The heading at `start` and what follows it, up to the next heading that ends the section.

    A heading of the same or a higher rank always ends it; `stop` is a pattern that ends it too.
    """
    regex = re.compile(stop, re.IGNORECASE) if stop else None
    end = len(blocks)
    for index in range(start + 1, len(blocks)):
        block = blocks[index]
        if block.level and (
            block.level <= blocks[start].level or regex and regex.search(block.text)
        ):
            end = index
            break
    return blocks[start:end]


# --- site adapters --------------------------------------------------------------------------

CAFE_ASTROLOGY_URL = "https://cafeastrology.com/thismonthinastrology.html"
ASTROLOGY_ZONE_INDEX = "https://www.astrologyzone.com/horoscopes/"


def read_cafe_astrology(html: str, target: Target) -> str:
    _, blocks = html_to_blocks(html)
    start = find_heading(blocks, rf"^{target.month} {target.year}$")
    if start is None:
        raise NoForecast
    # The page holds several months, each under its own "Month YYYY" heading.
    end = find_heading(blocks, rf"^(?:{_ANY_MONTH}) \d{{4}}$|^(?:Previous|Next) Month", start + 1)
    month = blocks[start:end]
    first_sign = find_heading(month, r"Overview Horoscopes|^Aries$", 1)
    parts = month[:first_sign]
    sign = find_heading(month, rf"^{target.sign}$", 1)
    if sign is not None:
        parts = parts + section(month, sign)
    timeline = find_heading(month, r"Aspects Time ?Line", 1)
    if timeline is not None:
        parts = parts + section(month, timeline)
    return blocks_text(parts)


async def cafe_astrology(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
    page = await fetch_page(deps, CAFE_ASTROLOGY_URL)
    title = f"This Month in Astrology: {target.label}"
    return [document(page.url, "Cafe Astrology", title, read_cafe_astrology(page.text, target))]


def read_astrology_zone(html: str, target: Target) -> str:
    """The forecast text of one page; raises NoForecast if the page is for another month."""
    _, blocks = html_to_blocks(html)
    start = find_heading(blocks, rf"{target.sign}\b.*Horoscope|Horoscope.*\b{target.sign}\b")
    if start is None or not any(b.level and target.named_in(b.text) for b in blocks):
        raise NoForecast
    body = find_heading(blocks, r"^Your .*Horoscope for", start)
    kept = []
    for block in section(blocks, start if body is None else body, r".")[1:]:
        if re.match(r"Pages:|View Previous Month|Print Horoscope", block.text):
            break
        if not re.fullmatch(r"by Susan Miller", block.text, re.IGNORECASE):
            kept.append(block)
    return blocks_text(kept)


async def astrology_zone(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
    index = await fetch_page(deps, ASTROLOGY_ZONE_INDEX)
    prefix = f"https://www.astrologyzone.com/forecasts/{target.sign.lower()}-horoscope-for-"
    first_url = next(
        (u for u in extract_links(index.text, index.url) if u.startswith(prefix)), None
    )
    if first_url is None:
        raise SourceError("The sign's forecast link was not found on the index page.")
    first = await fetch_page(deps, first_url)
    texts = [read_astrology_zone(first.text, target)]
    numbers = [
        int(m.group(1))
        for link in extract_links(first.text, first.url)
        if (m := re.fullmatch(re.escape(first_url) + r"(\d{1,2})/?", link))
    ]
    for number in range(2, min(max(numbers, default=1), MAX_PAGINATED_PAGES) + 1):
        if sum(map(len, texts)) >= MAX_DOCUMENT_LENGTH:
            break
        await asyncio.sleep(deps.page_pause_seconds)
        try:
            page = await fetch_page(deps, f"{first_url}{number}/")
            texts.append(read_astrology_zone(page.text, target))
        except (SourceError, NoForecast):
            break  # keep the pages read so far
    title = f"{target.sign} Horoscope for {target.label} by Susan Miller"
    return [document(first_url, "Astrology Zone", title, "\n\n".join(texts))]


def read_astrostyle(html: str, target: Target) -> str:
    _, blocks = html_to_blocks(html)
    start = find_heading(blocks, rf"Monthly\s+Horoscope\s+{target.month},?\s+{target.year}")
    if start is None:
        raise NoForecast
    kept = section(blocks, start, r"^More About|Celebrities")
    end = next((i for i, b in enumerate(kept) if re.match(r"Get Your Horoscope in", b.text)), None)
    return blocks_text(kept[:end])


async def astrostyle(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
    page = await fetch_page(
        deps, f"https://astrostyle.com/horoscopes/monthly/{target.sign.lower()}/"
    )
    title = f"{target.sign} Monthly Horoscope {target.label} by The AstroTwins"
    return [document(page.url, "Astrostyle", title, read_astrostyle(page.text, target))]


def read_sally_kirkman(html: str, target: Target) -> str:
    _, blocks = html_to_blocks(html)
    start = find_heading(blocks, rf"{target.sign}\s+Horoscope\s+{target.month},?\s+{target.year}")
    if start is None:
        raise NoForecast
    return blocks_text(section(blocks, start, r"Inner Star Circle|Leave a Comment"))


async def sally_kirkman(deps: PipelineDeps, target: Target) -> list[dict[str, str]]:
    # The sign page lists one teaser per month; the full text is on the linked post.
    listing = await fetch_page(
        deps, f"https://sallykirkman.com/{target.sign.lower()}-monthly-horoscopes/"
    )
    slug = f"/{target.sign}-horoscope-{target.month}-{target.year}/".lower()
    post_url = next((u for u in extract_links(listing.text, listing.url) if slug in u), None)
    if post_url is None:
        raise NoForecast
    page = await fetch_page(deps, post_url)
    title = f"{target.sign} Horoscope {target.label} by Sally Kirkman"
    return [document(page.url, "Sally Kirkman", title, read_sally_kirkman(page.text, target))]


def read_generic_page(html: str, target: Target) -> tuple[str, str]:
    """(title, text) of any page that names the target month; cut to the sign where possible."""
    title, blocks = html_to_blocks(html)
    main = [b for b in blocks if b.main]
    if sum(len(b.text) for b in main) >= 500:
        blocks = main
    if not target.named_in(title) and not any(target.named_in(b.text) for b in blocks):
        raise NoForecast

    def sign_heading(sign: str) -> int | None:
        return next(
            (
                i
                for i, b in enumerate(blocks)
                if b.level
                and len(b.text) <= 60
                and re.search(rf"\b{sign}\b", b.text, re.IGNORECASE)
            ),
            None,
        )

    found = {sign: index for sign in ZODIAC_ORDER if (index := sign_heading(sign)) is not None}
    if target.sign in found and len(found) >= 6:
        # An all-signs page: keep the general lead and this sign's section.
        blocks = blocks[: min(found.values())] + section(blocks, found[target.sign])
    return title, blocks_text(blocks)


async def generic_page(deps: PipelineDeps, target: Target, url: str) -> list[dict[str, str]]:
    page = await fetch_page(deps, url)
    title, text = read_generic_page(page.text, target)
    if not text.strip():
        raise NoForecast
    host = (urlsplit(page.url).hostname or "").removeprefix("www.")
    return [document(page.url, host, title or host, text)]
