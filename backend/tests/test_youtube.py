import pytest

from app.webpages import MAX_DOCUMENT_LENGTH, NoForecast, SourceError, Target
from app.youtube import (
    Video,
    find_monthly_video,
    is_youtube_url,
    parse_chapters,
    parse_feed,
    resolve_channel_id,
    sign_chapters,
    slice_transcript,
    video_documents,
    youtube_channel,
    youtube_url,
)

from .helpers import (
    RUX_FEED_URL,
    RUX_SCORPIO_URL,
    RUX_VIDEO_URL,
    TRANSCRIPT,
    Upstream,
    fixture,
    make_deps,
)

SCORPIO = Target("Scorpio", "November", 2026)
CHANNEL = "UCII6kihNiLhgxgO6kzXnyPw"


def videos():
    return parse_feed(fixture("youtube_feed.xml"))


def test_parse_feed_lists_videos_without_shorts():
    feed = videos()
    assert [v.id for v in feed] == ["newmoonAAAA", "nov26AAAAAA", "oct26AAAAAA", "nov25AAAAAA"]
    monthly = feed[1]
    assert monthly.channel == "Written in the Stars by Rux"
    assert monthly.title.startswith("NOVEMBER '26 MONTHLY HOROSCOPE All Signs: Venus & Mercury")
    assert monthly.published.isoformat() == "2026-10-28"
    assert "00:03:00 Scorpio" in monthly.description
    with pytest.raises(SourceError):
        parse_feed("<html>not a feed")
    with pytest.raises(SourceError):  # entity expansion is refused
        parse_feed('<!DOCTYPE x [<!ENTITY a "aaaa">]><feed>&a;</feed>')


def test_find_monthly_video_matches_month_and_year_in_the_title():
    def found(month, year):
        video = find_monthly_video(videos(), Target("Scorpio", month, year))
        return video.id if video else None

    assert found("November", 2026) == "nov26AAAAAA"
    assert found("October", 2026) == "oct26AAAAAA"
    assert found("November", 2025) == "nov25AAAAAA"
    assert found("December", 2026) is None
    assert found("November", 2027) is None


def test_find_monthly_video_without_a_year_needs_monthly_and_a_fitting_publish_date():
    def video(title, published):
        return Video("abcdefghijk", title, "", published, "Channel")

    from datetime import date

    ok = video("Your November monthly forecast", date(2026, 10, 30))
    assert find_monthly_video([ok], SCORPIO) is ok
    assert (
        find_monthly_video([video("Your November monthly forecast", date(2025, 10, 30))], SCORPIO)
        is None
    )
    assert (
        find_monthly_video([video("November horoscope update", date(2026, 10, 30))], SCORPIO)
        is None
    )
    assert find_monthly_video([video("November 2026 vlog", date(2026, 10, 30))], SCORPIO) is None
    curly = video("November ’26 horoscope", None)
    assert find_monthly_video([curly, ok], SCORPIO) is curly


def test_parse_chapters_reads_timestamps_and_ignores_other_lines():
    description = "Book: https://x.example/1h-live\n1:02:03 Scorpio\n00:00 Intro\n 05:30 - Aries rising\n99:99 no\n12:00"
    assert parse_chapters(description) == [(0, "Intro"), (330, "Aries rising"), (3723, "Scorpio")]
    assert sign_chapters(parse_chapters(description)) == {
        "Aries": (330, 3723),
        "Scorpio": (3723, float("inf")),
    }
    # A label naming several signs is not a sign chapter.
    assert sign_chapters([(0, "Aries & Taurus"), (60, "Outro")]) == {}


def test_slice_transcript_takes_the_half_open_interval():
    assert slice_transcript(TRANSCRIPT, 180, 240) == (
        "my dear scorpios on the 13th of november mercury and venus turn direct"
    )
    assert slice_transcript(TRANSCRIPT, 500, 600) == ""


def test_video_documents_are_the_overview_and_the_sign_chapter_with_a_deep_link():
    video = videos()[1]
    overview, chapter = video_documents(video, TRANSCRIPT, SCORPIO)
    assert overview["url"] == RUX_VIDEO_URL
    assert overview["title"].endswith("(general overview)")
    assert overview["content"] == (
        "hello everybody this is the general overview the new moon is on the 9th of november"
    )
    assert chapter["url"] == RUX_SCORPIO_URL and chapter["title"].endswith("(Scorpio)")
    assert chapter["source"] == "Written in the Stars by Rux"
    assert "aries" not in chapter["content"] and "sagittarians" not in chapter["content"]

    # Chapters exist but not for this sign: its part cannot be found.
    with pytest.raises(SourceError, match="no timestamp for Leo"):
        video_documents(video, TRANSCRIPT, Target("Leo", "November", 2026))


def test_a_video_without_chapters_is_used_whole_only_when_it_is_short():
    plain = Video("abcdefghijk", "November 2026 forecast", "no timestamps", None, "")
    [doc] = video_documents(plain, TRANSCRIPT, SCORPIO)
    assert (
        doc["url"] == "https://www.youtube.com/watch?v=abcdefghijk" and doc["source"] == "YouTube"
    )
    long_cues = [(float(i), "word " * 100) for i in range(MAX_DOCUMENT_LENGTH // 400)]
    with pytest.raises(SourceError):
        video_documents(plain, long_cues, SCORPIO)


async def test_youtube_channel_reads_the_feed_then_the_transcript():
    upstream = Upstream(pages={RUX_FEED_URL: fixture("youtube_feed.xml")})
    deps = make_deps(upstream)
    documents = await youtube_channel(deps, SCORPIO, CHANNEL)
    assert [d["url"] for d in documents] == [RUX_VIDEO_URL, RUX_SCORPIO_URL]
    assert upstream.page_calls == [RUX_FEED_URL]

    with pytest.raises(NoForecast):
        await youtube_channel(deps, Target("Scorpio", "December", 2026), CHANNEL)
    # The October video exists but its transcript cannot be downloaded.
    with pytest.raises(SourceError, match="transcript"):
        await youtube_channel(deps, Target("Aries", "October", 2026), CHANNEL)
    deps.fetch_transcript = lambda video_id: []
    with pytest.raises(SourceError, match="no English transcript"):
        await youtube_channel(deps, SCORPIO, CHANNEL)


async def test_user_youtube_addresses_are_resolved_to_their_channel():
    handle = "https://www.youtube.com/@WrittenintheStarsbyRux"
    watch = "https://www.youtube.com/watch?v=nov26AAAAAA"
    pages = {
        handle: f'<link rel="canonical" href="https://www.youtube.com/channel/{CHANNEL}">',
        watch: f'<script>{{"videoDetails":{{"channelId":"{CHANNEL}"}}}}</script>',
        "https://www.youtube.com/@nobody": "<html>nothing here</html>",
        RUX_FEED_URL: fixture("youtube_feed.xml"),
    }
    upstream = Upstream(pages=pages)
    deps = make_deps(upstream)
    assert (
        await resolve_channel_id(deps, f"https://youtube.com/channel/{CHANNEL}/videos") == CHANNEL
    )
    assert upstream.page_calls == []
    assert await resolve_channel_id(deps, handle) == CHANNEL
    assert await resolve_channel_id(deps, "https://youtu.be/nov26AAAAAA?si=abc") == CHANNEL
    assert await resolve_channel_id(deps, watch + "&t=10s") == CHANNEL
    with pytest.raises(SourceError, match="No YouTube channel"):
        await resolve_channel_id(deps, "https://www.youtube.com/@nobody")

    documents = await youtube_url(deps, SCORPIO, handle)
    assert [d["url"] for d in documents] == [RUX_VIDEO_URL, RUX_SCORPIO_URL]


def test_is_youtube_url():
    assert is_youtube_url("https://youtu.be/abc") and is_youtube_url("https://M.YouTube.com/@x")
    assert not is_youtube_url("https://youtube.com.evil.example/") and not is_youtube_url("x")
