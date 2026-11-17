"""Request, profile and forecast validation shared by the API and the pipeline."""

from __future__ import annotations

import calendar
import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

LIFE_PRIORITIES = [
    "careerTransition",
    "contractNegotiations",
    "datingRomance",
    "healthHabits",
    "financialPlanning",
]

PRIORITY_LABELS = {
    "careerTransition": "Career Transition",
    "contractNegotiations": "Contract Negotiations",
    "datingRomance": "Dating & Romance",
    "healthHabits": "Health & Habits",
    "financialPlanning": "Financial Planning",
}

IMPACT_TYPES = ["Opportunity", "Caution", "Milestone"]

ACTIVITY_CATEGORIES = [
    "career",
    "social",
    "hobbies",
    "finance",
    "wellness",
    "mind",
    "strategic",
    "rest",
]

MAX_QUERY_LENGTH = 380
MAX_EVENTS = 60
MAX_TITLE_LENGTH = 200
MAX_SUMMARY_LENGTH = 4000
MAX_THEME_LENGTH = 8000
MAX_SOURCE_URLS_PER_EVENT = 10
MAX_RESULTS = 10
MAX_RESULT_CONTENT_LENGTH = 12000
MAX_EXCERPT_LENGTH = 8000
MAX_NAME_LENGTH = 120
MAX_LOCATION_LENGTH = 200

MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]

ZODIAC_SIGNS = frozenset(
    [
        "Aries",
        "Taurus",
        "Gemini",
        "Cancer",
        "Leo",
        "Virgo",
        "Libra",
        "Scorpio",
        "Sagittarius",
        "Capricorn",
        "Aquarius",
        "Pisces",
    ]
)

_PRIORITY_SET = frozenset(LIFE_PRIORITIES)
_IMPACT_SET = frozenset(IMPACT_TYPES)
_CATEGORY_SET = frozenset(ACTIVITY_CATEGORIES)
_MISSING: Any = object()

_MONTH_RE = re.compile(r"([A-Za-z]+)\s+([0-9]{4})")
_DATE_RE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
_TIME_RE = re.compile(r"([0-9]{2}):([0-9]{2})")
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```")


@dataclass(frozen=True)
class MonthRange:
    year: int
    month: int
    days_in_month: int
    first_date: str
    last_date: str


def format_date(year: int, month: int, day: int) -> str:
    return f"{year}-{month:02d}-{day:02d}"


def parse_month_range(value: Any) -> MonthRange | None:
    """Parse a strict English "Month YYYY" string, e.g. "November 2026"."""
    if not isinstance(value, str):
        return None
    match = _MONTH_RE.fullmatch(value.strip())
    if not match or match.group(1) not in MONTH_NAMES:
        return None
    year = int(match.group(2))
    if year < 1900 or year > 2200:
        return None
    month = MONTH_NAMES.index(match.group(1)) + 1
    days = calendar.monthrange(year, month)[1]
    return MonthRange(
        year=year,
        month=month,
        days_in_month=days,
        first_date=format_date(year, month, 1),
        last_date=format_date(year, month, days),
    )


def parse_iso_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    match = _DATE_RE.fullmatch(value)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def inclusive_day_span(start: str, end: str) -> list[str]:
    first, last = parse_iso_date(start), parse_iso_date(end)
    if not first or not last or last < first:
        return []
    return [
        (first + timedelta(days=offset)).isoformat() for offset in range((last - first).days + 1)
    ]


def is_http_url(value: Any) -> bool:
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        parts = urlsplit(value)
        return parts.scheme in ("http", "https") and bool(parts.hostname)
    except ValueError:
        return False


def is_valid_backend_url(value: Any) -> bool:
    if value is None or value == "":
        return True
    if not is_http_url(value):
        return False
    parts = urlsplit(value)
    return not (parts.username or parts.password or parts.query or parts.fragment)


def is_uuid(value: Any) -> bool:
    return isinstance(value, str) and _UUID_RE.fullmatch(value) is not None


def is_valid_time_zone(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > 100:
        return False
    try:
        ZoneInfo(value)
        return True
    except (KeyError, ValueError, OSError):
        return False


def is_valid_birth_time(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    match = _TIME_RE.fullmatch(value)
    return bool(match) and int(match.group(1)) <= 23 and int(match.group(2)) <= 59


def is_utf8_safe(value: Any) -> bool:
    """False if the JSON value holds text that cannot be encoded as UTF-8 (lone surrogates)."""
    try:
        json.dumps(value, ensure_ascii=False).encode("utf-8")
        return True
    except (UnicodeEncodeError, TypeError, ValueError):
        return False


def _in(value: Any, allowed: frozenset[str]) -> bool:
    return isinstance(value, str) and value in allowed


def _has_duplicates(items: list[Any]) -> bool:
    strings = [item for item in items if isinstance(item, str)]
    return len(set(strings)) != len(strings)


def validate_user_profile(profile: Any) -> list[str]:
    """Return a list of validation errors; an empty list means the profile is valid."""
    if not isinstance(profile, dict):
        return ["profile must be an object"]
    errors: list[str] = []
    p = profile

    name = p.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME_LENGTH:
        errors.append("name must be a nonempty string up to 120 chars")
    if not parse_iso_date(p.get("birthDate")):
        errors.append("birthDate must be a real YYYY-MM-DD date")
    location = p.get("birthLocation")
    if not isinstance(location, str) or len(location) > MAX_LOCATION_LENGTH:
        errors.append("birthLocation must be a bounded string")
    if not isinstance(p.get("hasExactTime"), bool):
        errors.append("hasExactTime must be a boolean")
    if not isinstance(p.get("useRisingPrimary"), bool):
        errors.append("useRisingPrimary must be a boolean")

    birth_time = p.get("birthTime", _MISSING)
    if p.get("hasExactTime") is True:
        if not is_valid_birth_time(birth_time):
            errors.append("birthTime must be a valid HH:mm time")
    elif birth_time is not _MISSING and birth_time != "" and not is_valid_birth_time(birth_time):
        errors.append("birthTime must be empty or a valid HH:mm time")

    if not _in(p.get("sunSign"), ZODIAC_SIGNS):
        errors.append("sunSign must be a valid zodiac sign")
    if not _in(p.get("moonSign"), ZODIAC_SIGNS):
        errors.append("moonSign must be a valid zodiac sign")
    rising = p.get("risingSign", _MISSING)
    if rising is not _MISSING and not _in(rising, ZODIAC_SIGNS):
        errors.append("risingSign must be a valid zodiac sign")

    if not is_valid_time_zone(p.get("birthTimezone")):
        errors.append("birthTimezone must be a valid IANA timezone")
    if not is_valid_time_zone(p.get("operatingTimezone")):
        errors.append("operatingTimezone must be a valid IANA timezone")

    if not parse_month_range(p.get("targetMonth")):
        errors.append('targetMonth must be in "Month YYYY" format, e.g. "November 2026"')

    priorities = p.get("priorities")
    if not isinstance(priorities, list):
        errors.append("priorities must be an array")
    else:
        if len(priorities) > len(LIFE_PRIORITIES):
            errors.append("priorities has too many entries")
        for item in priorities:
            if not _in(item, _PRIORITY_SET):
                errors.append(f"unknown priority: {item}")
        if _has_duplicates(priorities):
            errors.append("priorities must not contain duplicates")

    categories = p.get("activeCategories")
    if not isinstance(categories, list) or not categories:
        errors.append("activeCategories must be a nonempty array")
    else:
        if len(categories) > len(ACTIVITY_CATEGORIES):
            errors.append("activeCategories has too many entries")
        for item in categories:
            if not _in(item, _CATEGORY_SET):
                errors.append(f"unknown activity category: {item}")
        if _has_duplicates(categories):
            errors.append("activeCategories must not contain duplicates")

    backend_url = p.get("backendUrl", _MISSING)
    if backend_url is not _MISSING and not is_valid_backend_url(backend_url):
        errors.append("backendUrl must be empty or a plain http(s) origin")

    return errors


PROFILE_KEYS = (
    "name",
    "birthDate",
    "birthTime",
    "hasExactTime",
    "birthLocation",
    "birthTimezone",
    "operatingTimezone",
    "sunSign",
    "moonSign",
    "risingSign",
    "useRisingPrimary",
    "activeCategories",
    "targetMonth",
    "priorities",
)


def sanitize_profile(profile: Any) -> dict[str, Any]:
    """Keep only the allowlisted profile fields (drops client-only ones such as backendUrl)."""
    src = profile if isinstance(profile, dict) else {}
    return {key: src[key] for key in PROFILE_KEYS if key in src}


def _reject_constant(name: str) -> Any:
    raise ValueError(f"invalid JSON constant {name}")


def parse_llm_json(raw: Any) -> Any:
    """Parse model output as JSON, unwrapping a single Markdown code fence. Never repairs."""
    text = (raw or "").strip()
    fence = _FENCE_RE.fullmatch(text)
    if fence:
        text = fence.group(1).strip()
    return json.loads(text, parse_constant=_reject_constant)


def _bounded_text(value: Any, max_length: int) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= max_length


def validate_forecast_payload(
    payload: Any,
    month: MonthRange,
    selected_priorities: list[str],
    allowed_source_urls: set[str],
) -> tuple[list[str], dict[str, Any] | None]:
    """Validate the forecast agent output. Returns (errors, result); result is None on errors."""
    if not isinstance(payload, dict):
        return ["forecast must be a JSON object"], None
    errors: list[str] = []

    theme = payload.get("overall_theme")
    if not _bounded_text(theme, MAX_THEME_LENGTH):
        errors.append("overall_theme must be a nonempty bounded string")
    raw_events = payload.get("events")
    if not isinstance(raw_events, list):
        errors.append("events must be an array")
        return errors, None
    if len(raw_events) > MAX_EVENTS:
        errors.append(f"events exceeds maximum of {MAX_EVENTS}")

    first = parse_iso_date(month.first_date)
    last = parse_iso_date(month.last_date)
    assert first and last
    events: list[dict[str, Any]] = []
    prev_start: date | None = None

    for idx, ev in enumerate(raw_events):
        label = f"events[{idx}]"
        if not isinstance(ev, dict):
            errors.append(f"{label} must be an object")
            continue
        errs: list[str] = []

        start = parse_iso_date(ev.get("date"))
        if not start:
            errors.append(f"{label}.date must be a real YYYY-MM-DD date")
            continue
        if start < first or start > last:
            errs.append(f"{label}.date is outside the target month")

        end_date: str | None = None
        if ev.get("end_date") is not None:
            end = parse_iso_date(ev.get("end_date"))
            if not end:
                errors.extend(errs)
                errors.append(f"{label}.end_date must be a real YYYY-MM-DD date")
                continue
            end_date = ev["end_date"]
            if end < start:
                errs.append(f"{label}.end_date must be >= date")
            if end > last:
                errs.append(f"{label}.end_date is outside the target month")

        if not _bounded_text(ev.get("title"), MAX_TITLE_LENGTH):
            errs.append(f"{label}.title must be a nonempty bounded string")
        if not _in(ev.get("impact_type"), _IMPACT_SET):
            errs.append(f"{label}.impact_type must be Opportunity, Caution, or Milestone")
        if not _bounded_text(ev.get("summary"), MAX_SUMMARY_LENGTH):
            errs.append(f"{label}.summary must be a nonempty bounded string")

        topics = ev.get("topics")
        if not isinstance(topics, list) or not topics:
            errs.append(f"{label}.topics must be a nonempty array")
        else:
            for topic in topics:
                if not _in(topic, _PRIORITY_SET):
                    errs.append(f"{label}.topics contains unknown topic {topic}")
            if _has_duplicates(topics):
                errs.append(f"{label}.topics must not contain duplicates")
            if selected_priorities and not any(
                isinstance(t, str) and t in selected_priorities for t in topics
            ):
                errs.append(f"{label}.topics must include at least one selected priority")

        urls = ev.get("source_urls")
        if not isinstance(urls, list) or not urls:
            errs.append(f"{label}.source_urls must be a nonempty array")
        else:
            if len(urls) > MAX_SOURCE_URLS_PER_EVENT:
                errs.append(f"{label}.source_urls has too many entries")
            for url in urls:
                if not is_http_url(url):
                    errs.append(f"{label}.source_urls must be http(s) URLs")
                elif url not in allowed_source_urls:
                    errs.append(f"{label}.source_urls contains a URL not in the search results")

        if prev_start is not None and start < prev_start:
            errs.append(f"{label} is out of chronological order")
        prev_start = start

        if errs:
            errors.extend(errs)
            continue
        event: dict[str, Any] = {"date": ev["date"]}
        if end_date:
            event["end_date"] = end_date
        event.update(
            title=ev["title"].strip(),
            impact_type=ev["impact_type"],
            summary=ev["summary"].strip(),
            topics=topics,
            source_urls=urls,
        )
        events.append(event)

    if errors:
        return errors, None
    return [], {"overall_theme": theme.strip(), "events": events}


def validate_agent_query(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    query = payload.get("query")
    if not _bounded_text(query, MAX_QUERY_LENGTH):
        return None
    return query.strip()
