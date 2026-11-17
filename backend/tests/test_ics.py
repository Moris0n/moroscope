from datetime import UTC, datetime

from app.ics import build_ics_calendar, fold_ics_line


def test_ics_builder_escapes_text_folds_long_lines_and_rolls_year_boundary():
    event = {
        "date": "2026-12-30",
        "end_date": "2026-12-31",
        "title": "Comma, semicolon; and \\backslash",
        "impact_type": "Caution",
        "summary": "Line one\nLine two — " + "é" * 120,
        "topics": ["healthHabits"],
        "source_urls": ["https://x.example/a,b"],
    }
    ics = build_ics_calendar([event], "2026-12", datetime(2026, 10, 18, 12, 0, tzinfo=UTC))

    assert "BEGIN:VCALENDAR" in ics
    assert "VERSION:2.0" in ics
    assert "DTSTART;VALUE=DATE:20261230" in ics
    assert "DTEND;VALUE=DATE:20270101" in ics
    assert "SUMMARY:[Caution] Comma\\, semicolon\\; and \\\\backslash" in ics
    assert "Line one\\nLine two" in ics
    assert "DTSTAMP:20261018T120000Z" in ics
    assert ics.endswith("\r\n")

    for line in ics.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75, line[:40]
    unfolded = ics.replace("\r\n ", "")
    assert "é" * 120 in unfolded
    assert "Life focus: Health & Habits" in unfolded
    assert "Sources: https://x.example/a\\,b" in unfolded


def test_ics_uid_matches_the_original_fnv1a_over_utf16_units():
    event = {
        "date": "2026-11-05",
        "title": "Mars ✨ 漢字 😀",
        "impact_type": "Opportunity",
        "summary": "s",
        "topics": ["careerTransition"],
        "source_urls": ["https://x.example/"],
    }
    ics = build_ics_calendar([event], "2026-11", datetime(2026, 1, 1, tzinfo=UTC))
    # Value computed with the original TypeScript implementation for the same input.
    assert "UID:255bccdd-0@moroscope" in ics


def test_ics_leap_year_exclusive_end_and_empty_calendar():
    event = {
        "date": "2028-02-28",
        "end_date": "2028-02-29",
        "title": "Leap day event",
        "impact_type": "Milestone",
        "summary": "Covers leap day.",
        "topics": ["financialPlanning"],
        "source_urls": ["https://x.example/"],
    }
    ics = build_ics_calendar([event], "2028-02")
    assert "DTSTART;VALUE=DATE:20280228" in ics
    assert "DTEND;VALUE=DATE:20280301" in ics

    empty = build_ics_calendar([], "2028-02")
    assert "BEGIN:VCALENDAR" in empty and "END:VCALENDAR" in empty
    assert "BEGIN:VEVENT" not in empty


def test_fold_ics_line_never_splits_utf8_sequences():
    line = "DESCRIPTION:" + "漢字" * 60
    folded = fold_ics_line(line)
    for part in folded.split("\r\n"):
        assert len(part.encode("utf-8")) <= 75
    assert folded.replace("\r\n ", "") == line
