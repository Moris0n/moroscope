"""Deterministic RFC 5545 calendar generation for validated forecast events."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from .validation import PRIORITY_LABELS

CRLF = "\r\n"
MAX_LINE_OCTETS = 75


def _escape_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def _fnv1a(value: str) -> str:
    # Hashes UTF-16 code units so UIDs stay identical to the original TypeScript implementation.
    data = value.encode("utf-16-le", "surrogatepass")
    h = 0x811C9DC5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def fold_ics_line(line: str) -> str:
    """Fold a content line to 75 octets without splitting a UTF-8 sequence."""
    data = line.encode("utf-8")
    if len(data) <= MAX_LINE_OCTETS:
        return line
    parts: list[str] = []
    offset = 0
    limit = MAX_LINE_OCTETS
    while offset < len(data):
        end = min(offset + limit, len(data))
        while end < len(data) and end > offset and (data[end] & 0xC0) == 0x80:
            end -= 1
        if end == offset:
            end = offset + limit
            while end < len(data) and (data[end] & 0xC0) == 0x80:
                end += 1
        parts.append(data[offset:end].decode("utf-8"))
        offset = end
        limit = MAX_LINE_OCTETS - 1
    return (CRLF + " ").join(parts)


def _ics_date(iso_date: str) -> str:
    return iso_date.replace("-", "")


def build_ics_calendar(
    events: list[dict[str, Any]], month_key: str, now: datetime | None = None
) -> str:
    """Build an all-day-event calendar. `end_date` on events is inclusive."""
    now = now or datetime.now(UTC)
    dtstamp = now.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Moroscope//Monthly Forecast//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]

    for index, ev in enumerate(events):
        end_date = ev.get("end_date") or ""
        exclusive_end = date.fromisoformat(end_date or ev["date"]) + timedelta(days=1)
        uid_source = (
            f"{month_key}|{index}|{ev['date']}|{end_date}|{ev['title']}|{ev['impact_type']}"
        )
        topic_labels = ", ".join(PRIORITY_LABELS.get(t, t) for t in ev["topics"])
        description = "\n\n".join(
            part
            for part in (
                ev["summary"],
                f"Impact: {ev['impact_type']}",
                f"Life focus: {topic_labels}" if topic_labels else "",
                f"Sources: {' | '.join(ev['source_urls'])}" if ev["source_urls"] else "",
            )
            if part
        )
        lines += [
            "BEGIN:VEVENT",
            f"UID:{_fnv1a(uid_source)}-{index}@moroscope",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART;VALUE=DATE:{_ics_date(ev['date'])}",
            f"DTEND;VALUE=DATE:{_ics_date(exclusive_end.isoformat())}",
            f"SUMMARY:{_escape_text(f'[{ev["impact_type"]}] {ev["title"]}')}",
            f"DESCRIPTION:{_escape_text(description)}",
            "END:VEVENT",
        ]

    lines.append("END:VCALENDAR")
    return CRLF.join(fold_ics_line(line) for line in lines) + CRLF
