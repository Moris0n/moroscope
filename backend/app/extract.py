"""The Extractor: dated events from one source document, each checked against that document.

The Extractor never sees anything about the user, so its answer for a document can be cached. What
it returns is not trusted: an event is kept only when its quote is found in the document and the
quote names the day of the event.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass, field, replace
from datetime import timedelta
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .config import AgentConfig, PipelineDeps, PipelineError
from .llm import call_nebius_chat
from .models import TONE_EVENT_TYPES, ExtractedEvent, ExtractorAnswer
from .prompts import EXTRACTOR_PROMPT
from .validation import MONTH_NAMES, MonthRange, parse_iso_date

logger = logging.getLogger("uvicorn.error")

EXTRACTION_CONCURRENCY = 3
# A quote shorter than this (letters and digits only) could match almost anywhere.
MIN_QUOTE_LENGTH = 12
# In a span of up to this many days, the quote may name any of them.
SHORT_SPAN_DAYS = 3

# How a source gives a window without naming its days: "the day before", "3 days after".
_BEFORE_RE = re.compile(r"\bdays? before\b")
_AFTER_RE = re.compile(r"\bdays? after\b")
_ELLIPSIS_RE = re.compile(r"\[?(?:\.{3,}|…)\]?")
_TOKEN_RE = re.compile(r"[a-z]+|[0-9]+")
_ORDINAL_SUFFIXES = ("st", "nd", "rd", "th")
_UNITS = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_UNIT_ORDINALS = (
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
)
_TEENS = (
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
)
_TEEN_ORDINALS = ("tenth", "eleventh", "twelfth") + tuple(f"{word}th" for word in _TEENS[3:])
_ORDINALS: dict[str, int] = {
    **{word: number for number, word in enumerate(_UNIT_ORDINALS, 1)},
    **{word: number for number, word in enumerate(_TEEN_ORDINALS, 10)},
    "twentieth": 20,
    "thirtieth": 30,
}
_CARDINALS: dict[str, int] = {
    **{word: number for number, word in enumerate(_UNITS, 1)},
    **{word: number for number, word in enumerate(_TEENS, 10)},
    "twenty": 20,
    "thirty": 30,
}
_TENS = {"twenty": 20, "thirty": 30}
_MONTH_WORDS = frozenset(name.lower() for name in MONTH_NAMES) | frozenset(
    name[:3].lower() for name in MONTH_NAMES
)


# --- checks against the document text (pure functions) -----------------------------------------


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower()


def squash(text: str) -> str:
    """Letters and digits only, lower case: how a quote and a document are compared."""
    return "".join(char for char in _plain(text) if char.isalnum())


def quote_in_document(quote: str, document: str) -> bool:
    """Whether the document contains the quote, whatever its case, punctuation and spacing.

    A quote the model shortened with "..." counts when its parts appear in that order.
    """
    parts = [squash(part) for part in _ELLIPSIS_RE.split(quote)]
    parts = [part for part in parts if part]
    if sum(map(len, parts)) < MIN_QUOTE_LENGTH:
        return False
    text, position = squash(document), 0
    for part in parts:
        found = text.find(part, position)
        if found < 0:
            return False
        position = found + len(part)
    return True


def days_named(text: str) -> set[int]:
    """The days of a month a text names: "9", "9th", "ninth", "twenty-second", "twenty second".

    A spelled-out cardinal counts only next to a month name ("november nine"), since "one" and
    "two" are ordinary words. Numbers above 31 (years) name no day.
    """
    tokens = _TOKEN_RE.findall(_plain(text))
    days: set[int] = set()
    index = 0
    while index < len(tokens):
        token = tokens[index]
        following = tokens[index + 1] if index + 1 < len(tokens) else ""
        length, day, ordinal = 1, 0, True
        if token.isdigit():
            day = int(token) if len(token) <= 2 else 0
        elif token in _TENS and following in _UNIT_ORDINALS:
            length, day = 2, _TENS[token] + _ORDINALS[following]
        elif token in _TENS and following in _UNITS:
            length, day, ordinal = 2, _TENS[token] + _CARDINALS[following], False
        elif token in _ORDINALS:
            day = _ORDINALS[token]
        elif token in _CARDINALS:
            day, ordinal = _CARDINALS[token], False
        before = tokens[index - 1] if index else ""
        after = tokens[index + length] if index + length < len(tokens) else ""
        if 1 <= day <= 31 and (ordinal or before in _MONTH_WORDS or after in _MONTH_WORDS):
            days.add(day)
        index += length
    return days


@dataclass(frozen=True)
class VerifiedEvent:
    """An extracted event that passed every check, with the document it came from."""

    id: str
    url: str
    source: str
    date: str
    end_date: str | None
    type: str
    event: ExtractedEvent
    # The days the source says the event is felt, within the month. The dates themselves are not
    # checked; a side is kept only when the quote names that day or counts days before (after).
    active_from: str | None = None
    active_until: str | None = None


def extracted_event_id(
    month_key: str, url: str, date: str, end_date: str | None, quote: str
) -> str:
    """From the source, the dates and the quote: the same as long as the extraction is the same."""
    key = "|".join((month_key, url, date, end_date or "", squash(quote)))
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def _quote_speaks_of(quote: str, day: str | None, words: re.Pattern[str]) -> bool:
    """Whether the quote backs one side of an active window: it names that day, or it counts
    days before (or after) the event ("the day before", "3 days after")."""
    if not day:
        return False
    return int(day[8:]) in days_named(quote) or words.search(_plain(quote)) is not None


def verify_event(
    event: ExtractedEvent, document: dict[str, str], month: MonthRange
) -> tuple[VerifiedEvent | None, str]:
    """(verified event, "") or (None, why it was dropped).

    Dates: a span reaching out of the month is cut to the month; an end date equal to the start
    is left out. The quote must be in the document and must name the day the event starts or
    ends on, except for an event that spans the whole month. For a span of up to three days any
    of its days will do: sources give such a window as its middle day ("the 28th, the day before
    and the day after").

    A sky event (one with an aspect) happens on one day; how long it is felt is its active
    window, not its end date. An end date the Extractor gave it all the same becomes the end of
    the window when the quote names the first day and not the last ("the Sun enters Sagittarius
    on the 22nd for a monthlong visit"). A quote that names both describes a real period.
    """
    start, end = event.date, event.end_date or event.date
    active_from, active_until = event.active_from, event.active_until
    if event.aspect and end > start:
        named = days_named(event.quote)
        if int(start[8:]) in named and int(end[8:]) not in named:
            active_until, end = active_until or end, start
    if end < start:
        return None, "the end date is before the start date"
    if start > month.last_date or end < month.first_date:
        return None, "the dates are outside the month"
    if not quote_in_document(event.quote, document["content"]):
        return None, "the quote is not in the source text"

    first, last = parse_iso_date(start), parse_iso_date(end)
    assert first and last  # both are validated dates
    length = (last - first).days + 1
    stated = (
        {(first + timedelta(days=offset)).day for offset in range(length)}
        if length <= SHORT_SPAN_DAYS
        else {first.day, last.day}
    )
    start, end = max(start, month.first_date), min(end, month.last_date)
    whole_month = (start, end) == (month.first_date, month.last_date)
    if not whole_month and not stated & days_named(event.quote):
        return None, "the quote does not name the day"

    end_date = end if end != start else None
    if end_date:
        active_from = active_until = None  # a period has no window around it
    # A window lies around the date and within the month; a side that does not is left out, and
    # so is a side the quote does not back: models fill in the end of the month by habit. This
    # also loses true but vague windows ("for the rest of the year").
    if not _quote_speaks_of(event.quote, active_from, _BEFORE_RE):
        active_from = None
    if not _quote_speaks_of(event.quote, active_until, _AFTER_RE):
        active_until = None
    active_from = max(active_from, month.first_date) if active_from else None
    active_until = min(active_until, month.last_date) if active_until else None
    if not active_from or active_from >= start:
        active_from = None
    if not active_until or active_until <= start:
        active_until = None
    month_key = f"{month.year}-{month.month:02d}"
    return (
        VerifiedEvent(
            id=extracted_event_id(month_key, document["url"], start, end_date, event.quote),
            url=document["url"],
            source=document["source"],
            date=start,
            end_date=end_date,
            type=TONE_EVENT_TYPES[event.tone],
            event=event,
            active_from=active_from,
            active_until=active_until,
        ),
        "",
    )


def verify_answer(
    raw_events: list[Any], document: dict[str, str], month: MonthRange
) -> tuple[list[VerifiedEvent], list[str]]:
    """The events of one Extractor answer that hold up, and why each of the others was dropped."""
    verified: dict[str, VerifiedEvent] = {}
    dropped: list[str] = []
    for raw in raw_events:
        try:
            event = ExtractedEvent.model_validate(raw)
        except ValidationError:
            dropped.append("the event has an invalid shape")
            continue
        checked, reason = verify_event(event, document, month)
        if checked is None:
            dropped.append(reason)
        elif checked.id in verified:
            dropped.append("the event was returned twice")
        else:
            verified[checked.id] = checked
    return _without_windows_onto_other_events(list(verified.values())), dropped


def _same_matter(one: VerifiedEvent, other: VerifiedEvent) -> bool:
    planets = set(one.event.planets or [])
    return squash(one.event.quote) == squash(other.event.quote) or (
        bool(planets) and planets == set(other.event.planets or [])
    )


def _without_windows_onto_other_events(events: list[VerifiedEvent]) -> list[VerifiedEvent]:
    """Leave out a window side that lands on the date of another event of the same document
    about the same matter (the same quote or the same planets): "on the 4th and the 28th" is
    two events, not one that is felt from the 4th until the 28th."""

    def lands_on_another(event: VerifiedEvent, day: str | None) -> bool:
        return day is not None and any(
            other.id != event.id and other.date == day and _same_matter(event, other)
            for other in events
        )

    return [
        replace(
            event,
            active_from=None if lands_on_another(event, event.active_from) else event.active_from,
            active_until=None
            if lands_on_another(event, event.active_until)
            else event.active_until,
        )
        for event in events
    ]


# --- cache -------------------------------------------------------------------------------------


def _cache_path(deps: PipelineDeps, config: AgentConfig, payload: dict[str, Any]) -> Path:
    """Keyed by everything the answer depends on: the request (month, sign, document text), the
    model and the prompt. None of it is about the user."""
    key = json.dumps(
        [config.nebius_model, EXTRACTOR_PROMPT, payload], ensure_ascii=False, sort_keys=True
    )
    name = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return deps.data_dir / "cache" / "extractions" / f"{name}.json"


def _read_cache(path: Path) -> list[Any] | None:
    try:
        events = json.loads(path.read_text(encoding="utf-8"))["events"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return events if isinstance(events, list) else None


def _write_cache(path: Path, events: list[Any]) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp.write_text(json.dumps({"events": events}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)  # the cache is an optimisation; extraction goes on without it


# --- extraction --------------------------------------------------------------------------------


def extractor_payload(month: dict[str, str], sign: str, document: dict[str, str]) -> dict[str, Any]:
    """Everything the Extractor is told: the month, the sign and one document. No user data."""
    return {
        "month": month,
        "sign": sign,
        "document": {key: document[key] for key in ("source", "title", "content")},
    }


@dataclass
class DocumentExtraction:
    url: str
    events: list[VerifiedEvent] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)
    error: PipelineError | None = None  # the Extractor gave no usable answer for this document
    cached: bool = False


async def extract_document(
    config: AgentConfig,
    deps: PipelineDeps,
    month: dict[str, str],
    month_range: MonthRange,
    sign: str,
    document: dict[str, str],
) -> DocumentExtraction:
    payload = extractor_payload(month, sign, document)
    path = _cache_path(deps, config, payload)
    raw_events = await asyncio.to_thread(_read_cache, path)
    cached = raw_events is not None
    if raw_events is None:
        try:
            answer = ExtractorAnswer.model_validate(
                await call_nebius_chat(config, deps, EXTRACTOR_PROMPT, payload)
            )
        except PipelineError as exc:
            return DocumentExtraction(document["url"], error=exc)
        except ValidationError:
            error = PipelineError(502, "Extractor returned invalid data.")
            return DocumentExtraction(document["url"], error=error)
        raw_events = answer.events
        await asyncio.to_thread(_write_cache, path, raw_events)
    events, dropped = verify_answer(raw_events, document, month_range)
    if dropped:
        # Reasons only: no text of the event.
        logger.warning(
            "Extraction of %s: %d event(s) kept, %d dropped (%s)",
            document["source"],
            len(events),
            len(dropped),
            "; ".join(sorted(set(dropped))),
        )
    return DocumentExtraction(document["url"], events, dropped, cached=cached)


async def extract_documents(
    config: AgentConfig,
    deps: PipelineDeps,
    month: dict[str, str],
    month_range: MonthRange,
    sign: str,
    documents: list[dict[str, str]],
) -> list[DocumentExtraction]:
    """One Extractor call per document, a few at a time, in the order of the documents.

    A document whose extraction fails is reported in its result; when every one fails, the first
    failure is raised.
    """
    limit = asyncio.Semaphore(EXTRACTION_CONCURRENCY)

    async def one(document: dict[str, str]) -> DocumentExtraction:
        async with limit:
            return await extract_document(config, deps, month, month_range, sign, document)

    results = list(await asyncio.gather(*(one(document) for document in documents)))
    errors = [result.error for result in results if result.error]
    if results and len(errors) == len(results):
        raise errors[0]
    return results
