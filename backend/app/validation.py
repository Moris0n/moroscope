"""Month and date helpers, small format checks and the parsing of model output.

The request, answer and response shapes themselves are Pydantic models (`models.py`).
"""

from __future__ import annotations

import calendar
import json
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from .models import Profile

MAX_QUERY_LENGTH = 380
MAX_EVENTS = 60
MAX_TITLE_LENGTH = 200
MAX_SUMMARY_LENGTH = 4000
MAX_THEME_LENGTH = 8000
MAX_SOURCE_URLS_PER_EVENT = 10
MAX_RESULTS = 10
MAX_RESULT_CONTENT_LENGTH = 12000
MAX_EXCERPT_LENGTH = 8000

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

ZODIAC_ORDER = (
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
)
ZODIAC_SIGNS = frozenset(ZODIAC_ORDER)

MIN_BIRTH_YEAR = 1900
MAX_BIRTH_YEAR = 2050

_MONTH_RE = re.compile(r"([A-Za-z]+)\s+([0-9]{4})")
_DATE_RE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
_TIME_RE = re.compile(r"([0-9]{2}):([0-9]{2})")
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_THINK_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
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


def primary_sign(profile: Profile) -> tuple[str, str]:
    """(sign, kind) the forecast is read for: the Rising sign when it leads, else the Sun sign."""
    if profile.mode == "general":
        return profile.sun_sign, "chosen"
    if profile.has_exact_time and profile.use_rising_primary and profile.rising_sign:
        return profile.rising_sign, "rising"
    return profile.sun_sign, "sun"


def _reject_constant(name: str) -> Any:
    raise ValueError(f"invalid JSON constant {name}")


def parse_llm_json(raw: Any) -> Any:
    """Parse model output as JSON. Never repairs the JSON itself.

    Reasoning models sometimes wrap the answer: a `<think>` block first, a Markdown code fence, or
    a sentence before or after. Those wrappers are removed; the JSON inside must be valid as is.
    """
    text = _THINK_RE.sub("", raw or "").strip()
    fence = _FENCE_RE.search(text)
    candidates = [text]
    if fence:
        candidates.append(fence.group(1).strip())
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start : end + 1])
    for candidate in candidates[:-1]:
        try:
            return json.loads(candidate, parse_constant=_reject_constant)
        except ValueError:
            continue
    return json.loads(candidates[-1], parse_constant=_reject_constant)
