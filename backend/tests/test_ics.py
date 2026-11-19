from datetime import UTC, datetime

from app.ics import build_ics_calendar, fold_ics_line
from app.models import ForecastEvent


def event(**fields) -> ForecastEvent:
    return ForecastEvent(
        **{
            "id": "0123456789ab",
            "date": "2026-11-05",
            "title": "Mars ingress",
            "type": "goodTime",
            "summary": "s",
            "lifeAreas": ["career"],
            "sourceUrls": ["https://x.example/"],
            **fields,
        }
    )


def test_ics_builder_escapes_text_folds_long_lines_and_rolls_year_boundary():
    ics = build_ics_calendar(
        [
            event(
                date="2026-12-30",
                endDate="2026-12-31",
                title="Comma, semicolon; and \\backslash",
                type="caution",
                summary="Line one\nLine two — " + "é" * 120,
                personalNote="Before your move, check the lease.",
                lifeAreas=["health", "communication"],
                sourceUrls=["https://x.example/a,b"],
            )
        ],
        datetime(2026, 10, 18, 12, 0, tzinfo=UTC),
    )

    assert "BEGIN:VCALENDAR" in ics
    assert "VERSION:2.0" in ics
    assert "DTSTART;VALUE=DATE:20261230" in ics
    assert "DTEND;VALUE=DATE:20270101" in ics
    assert "SUMMARY:[Be careful] Comma\\, semicolon\\; and \\\\backslash" in ics
    assert "Line one\\nLine two" in ics
    assert "DTSTAMP:20261018T120000Z" in ics
    assert ics.endswith("\r\n")

    for line in ics.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75, line[:40]
    unfolded = ics.replace("\r\n ", "")
    assert "é" * 120 in unfolded
    assert "For you: Before your move\\, check the lease." in unfolded
    assert "Life areas: Health & Wellbeing\\, Communication & Contracts" in unfolded
    assert "Sources: https://x.example/a\\,b" in unfolded


def test_ics_uid_comes_from_the_event_id_and_titles_carry_the_event_type():
    ics = build_ics_calendar(
        [event(title="Mars ✨ 漢字 😀"), event(id="0123456789ab-2", type="keyDate")],
        datetime(2026, 1, 1, tzinfo=UTC),
    )
    assert "UID:0123456789ab@moroscope" in ics
    assert "UID:0123456789ab-2@moroscope" in ics
    assert "SUMMARY:[Good time] Mars ✨ 漢字 😀" in ics
    assert "SUMMARY:[Key date] Mars ingress" in ics
    assert "For you" not in ics


def test_ics_leap_year_exclusive_end_and_empty_calendar():
    ics = build_ics_calendar([event(date="2028-02-28", endDate="2028-02-29")])
    assert "DTSTART;VALUE=DATE:20280228" in ics
    assert "DTEND;VALUE=DATE:20280301" in ics

    empty = build_ics_calendar([])
    assert "BEGIN:VCALENDAR" in empty and "END:VCALENDAR" in empty
    assert "BEGIN:VEVENT" not in empty


def test_fold_ics_line_never_splits_utf8_sequences():
    line = "DESCRIPTION:" + "漢字" * 60
    folded = fold_ics_line(line)
    for part in folded.split("\r\n"):
        assert len(part.encode("utf-8")) <= 75
    assert folded.replace("\r\n ", "") == line
