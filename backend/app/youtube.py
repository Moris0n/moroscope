"""Reading a YouTube channel's monthly forecast: channel feed, chapter timestamps, transcript."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

from defusedxml import ElementTree

from .config import PipelineDeps
from .validation import MONTH_NAMES, ZODIAC_ORDER
from .webpages import (
    MAX_DOCUMENT_LENGTH,
    XML_TYPES,
    NoForecast,
    SourceError,
    Target,
    document,
    fetch_page,
)

Cue = tuple[float, str]  # (start in seconds, text)

YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"})
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
# Skips the cookie-consent interstitial that YouTube shows to European visitors.
_CONSENT = {"Cookie": "SOCS=CAI"}
_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}
_CHANNEL_ID = r"UC[\w-]{22}"
_VIDEO_ID_RE = re.compile(r"[\w-]{11}")
_CHAPTER_RE = re.compile(r"^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—|:]?\s*(\S.*?)\s*$")
_KEYWORD_RE = re.compile(r"monthly|horoscope|forecast")
_PUBLISHED_EARLY_DAYS = 45


@dataclass(frozen=True)
class Video:
    id: str
    title: str
    description: str
    published: date | None
    channel: str


def is_youtube_url(url: str) -> bool:
    try:
        return (urlsplit(url).hostname or "").lower() in YOUTUBE_HOSTS
    except ValueError:
        return False


def parse_feed(xml: str) -> list[Video]:
    """The videos of a channel's Atom feed, newest first as YouTube lists them. Shorts are left out."""
    try:
        root = ElementTree.fromstring(xml)
    except Exception:  # noqa: BLE001 - any parser or defusedxml error means an unreadable feed
        raise SourceError("The channel's video list could not be read.") from None
    channel = root.findtext("atom:title", "", _NS).strip()
    videos = []
    for entry in root.findall("atom:entry", _NS):
        video_id = entry.findtext("yt:videoId", "", _NS).strip()
        link = entry.find("atom:link", _NS)
        if not _VIDEO_ID_RE.fullmatch(video_id):
            continue
        if link is not None and "/shorts/" in (link.get("href") or ""):
            continue
        try:
            published = datetime.fromisoformat(entry.findtext("atom:published", "", _NS)).date()
        except ValueError:
            published = None
        videos.append(
            Video(
                id=video_id,
                title=entry.findtext("atom:title", "", _NS).strip(),
                description=entry.findtext("media:group/media:description", "", _NS),
                published=published,
                channel=channel,
            )
        )
    return videos


def find_monthly_video(videos: list[Video], target: Target) -> Video | None:
    """The video whose title says it is the forecast for the target month and year."""
    first = date(target.year, MONTH_NAMES.index(target.month) + 1, 1)
    short_year = f"{target.year % 100:02d}"
    best: tuple[tuple[bool, bool, date], Video] | None = None
    for video in videos:
        title = video.title.lower()
        if not re.search(rf"\b{target.month.lower()}\b", title) or not _KEYWORD_RE.search(title):
            continue
        years = re.findall(r"\b(?:19|20)\d\d\b", title) + [
            "20" + yy for yy in re.findall(r"['’‘](\d\d)\b", title)
        ]
        names_year = f"20{short_year}" in years or str(target.year) in years
        if years and not names_year:
            continue
        monthly = "monthly" in title
        if not names_year:
            # No year in the title: accept a "monthly" video published just before or in the month.
            published = video.published
            in_window = published is not None and (
                first - timedelta(days=_PUBLISHED_EARLY_DAYS) <= published < first + timedelta(31)
            )
            if not (monthly and in_window):
                continue
        key = (names_year, monthly, video.published or date.min)
        if best is None or key > best[0]:
            best = (key, video)
    return best[1] if best else None


def parse_chapters(description: str) -> list[tuple[int, str]]:
    """`HH:MM:SS Label` or `MM:SS Label` lines of a video description, in time order."""
    chapters = []
    for line in description.splitlines():
        match = _CHAPTER_RE.match(line)
        if match and int(match.group(2)) < 60 and int(match.group(3)) < 60:
            hours = int(match.group(1) or 0)
            seconds = hours * 3600 + int(match.group(2)) * 60 + int(match.group(3))
            chapters.append((seconds, match.group(4)))
    return sorted(chapters)


def sign_chapters(chapters: list[tuple[int, str]]) -> dict[str, tuple[int, float]]:
    """Sign name -> (start, end) for the chapters whose label names exactly one sign."""
    found: dict[str, tuple[int, float]] = {}
    for index, (start, label) in enumerate(chapters):
        named = [sign for sign in ZODIAC_ORDER if re.search(rf"\b{sign}\b", label, re.IGNORECASE)]
        if len(named) == 1 and named[0] not in found:
            end = chapters[index + 1][0] if index + 1 < len(chapters) else float("inf")
            found[named[0]] = (start, end)
    return found


def slice_transcript(cues: list[Cue], start: float, end: float) -> str:
    text = " ".join(text.strip() for at, text in cues if start <= at < end)
    return re.sub(r"\s+", " ", text).strip()


def watch_url(video_id: str, seconds: int = 0) -> str:
    url = f"https://www.youtube.com/watch?v={video_id}"
    return f"{url}&t={seconds}s" if seconds else url


def video_documents(video: Video, cues: list[Cue], target: Target) -> list[dict[str, str]]:
    """The sign's chapter of a monthly video. The general introduction before it is left out."""
    signs = sign_chapters(parse_chapters(video.description))
    source = video.channel or "YouTube"
    if target.sign not in signs:
        whole = slice_transcript(cues, 0, float("inf"))
        if signs or len(whole) > MAX_DOCUMENT_LENGTH:
            raise SourceError(
                f"The video has no timestamp for {target.sign}, so its part cannot be found."
            )
        return [document(watch_url(video.id), source, video.title, whole)] if whole else []
    start, end = signs[target.sign]
    chapter = slice_transcript(cues, start, end)
    title = f"{video.title} ({target.sign})"
    return [document(watch_url(video.id, start), source, title, chapter)] if chapter else []


def default_fetch_transcript(video_id: str) -> list[Cue]:
    from youtube_transcript_api import YouTubeTranscriptApi

    fetched = YouTubeTranscriptApi().fetch(video_id, languages=("en", "en-US", "en-GB"))
    return [(float(snippet.start), snippet.text) for snippet in fetched]


async def fetch_transcript(deps: PipelineDeps, video_id: str) -> list[Cue]:
    try:
        cues = await asyncio.to_thread(deps.fetch_transcript or default_fetch_transcript, video_id)
    except Exception:  # noqa: BLE001 - the transcript library raises many unrelated types
        raise SourceError("The video's English transcript could not be downloaded.") from None
    if not cues:
        raise SourceError("The video has no English transcript.")
    return cues


async def youtube_channel(
    deps: PipelineDeps, target: Target, channel_id: str
) -> list[dict[str, str]]:
    feed = await fetch_page(deps, FEED_URL.format(channel_id=channel_id), accept=XML_TYPES)
    video = find_monthly_video(parse_feed(feed.text), target)
    if video is None:
        raise NoForecast
    documents = video_documents(video, await fetch_transcript(deps, video.id), target)
    if not documents:
        raise NoForecast
    return documents


async def resolve_channel_id(deps: PipelineDeps, url: str) -> str:
    """The channel behind a YouTube channel, handle or video URL."""
    parts = urlsplit(url)
    direct = re.fullmatch(rf"/channel/({_CHANNEL_ID})(?:/.*)?", parts.path)
    if direct:
        return direct.group(1)
    if (parts.hostname or "").lower() == "youtu.be":
        url = watch_url(parts.path.strip("/")[:11])
    elif parts.path == "/watch":
        url = watch_url(parse_qs(parts.query).get("v", [""])[0][:11])
    page = await fetch_page(deps, url, headers=_CONSENT)
    for pattern in (
        rf'<link rel="canonical" href="https://www\.youtube\.com/channel/({_CHANNEL_ID})"',
        rf'<meta itemprop="(?:channelId|identifier)" content="({_CHANNEL_ID})"',
        rf'"(?:channelId|externalId)":"({_CHANNEL_ID})"',
    ):
        match = re.search(pattern, page.text)
        if match:
            return match.group(1)
    raise SourceError("No YouTube channel was found at that address.")


async def youtube_url(deps: PipelineDeps, target: Target, url: str) -> list[dict[str, str]]:
    return await youtube_channel(deps, target, await resolve_channel_id(deps, url))
