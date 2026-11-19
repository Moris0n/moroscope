"""From verified events to the forecast the app shows: ranking, the Synthesizer's input, assembly.

The Synthesizer only words the forecast. It names extracted events by id; dates, event types,
life areas, houses and citations are taken from those events here, in code.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from .extract import VerifiedEvent
from .ics import build_ics_calendar
from .models import (
    MAX_SOURCE_URLS_PER_EVENT,
    ActiveWindow,
    ForecastEvent,
    MonthlyForecast,
    SynthesizedGroup,
    SynthesizerAnswer,
    error_messages,
)
from .priorities import Priorities, house_of, with_house_areas
from .validation import MAX_EXCERPT_LENGTH

logger = logging.getLogger("uvicorn.error")


def empty_forecast(theme: str) -> MonthlyForecast:
    return MonthlyForecast(theme=theme, events=[], ics_content=build_ics_calendar([]))


@dataclass(frozen=True)
class RankedEvent:
    """A verified event with what code adds to it: the house, its life areas and its rank."""

    verified: VerifiedEvent
    house: int | None
    life_areas: tuple[str, ...]
    rank: int | None  # place of the first priority it touches, from 0; None: none of them

    @property
    def id(self) -> str:
        return self.verified.id

    @property
    def dates(self) -> tuple[str, str | None]:
        return self.verified.date, self.verified.end_date


def rank_events(
    events: list[VerifiedEvent], priorities: Priorities, reading_sign: str
) -> list[RankedEvent]:
    """Every event, most important first: by priority, then by date. Nothing is filtered out.

    The house is the one the source states; when it names only a zodiac sign, the whole-sign
    house counted from the reading sign. Only a house worked out here adds its life areas to the
    event: where the source states the house, the Extractor read what the source ties it to.
    """
    ranked = []
    for verified in events:
        event = verified.event
        house = event.house or house_of(event.in_sign, reading_sign)
        areas = with_house_areas(list(event.life_areas), None if event.house else house)
        ranked.append(RankedEvent(verified, house, tuple(areas), priorities.rank(areas, house)))
    last = len(priorities.ranked)
    return sorted(ranked, key=lambda e: (last if e.rank is None else e.rank, e.verified.date, e.id))


def synthesizer_payload(
    month: dict[str, str],
    sign: str,
    priorities: Priorities,
    upcoming_events: list[dict[str, str]],
    events: list[RankedEvent],
    custom_excerpt: str | None = None,
) -> dict[str, Any]:
    """Everything the Synthesizer is told. No source text: not the documents, not the quotes."""
    listed = []
    for ranked in events:
        verified, event = ranked.verified, ranked.verified.event
        entry: dict[str, Any] = {
            "id": ranked.id,
            "date": verified.date,
            "endDate": verified.end_date,
            "type": verified.type,
            "lifeAreas": list(ranked.life_areas),
            "title": event.title,
            "advice": event.advice,
            "source": verified.source,
            "inFocus": ranked.rank is not None,
            "priority": None if ranked.rank is None else ranked.rank + 1,
            "planets": event.planets,
            "aspect": event.aspect,
            "house": ranked.house,
            "activeFrom": verified.active_from,
            "activeUntil": verified.active_until,
        }
        listed.append({key: value for key, value in entry.items() if value is not None})
    payload: dict[str, Any] = {
        "month": month,
        "sign": sign,
        "priorities": priorities.narrative(),
        "events": listed,
    }
    if upcoming_events:
        payload["upcomingEvents"] = upcoming_events
    if isinstance(custom_excerpt, str) and custom_excerpt.strip():
        payload["customExcerpt"] = custom_excerpt[:MAX_EXCERPT_LENGTH]
    return payload


def _merged_type(members: list[RankedEvent]) -> str:
    """The members' shared direction; a key date when they are neutral or point both ways."""
    directions = {m.verified.type for m in members} - {"keyDate"}
    return directions.pop() if len(directions) == 1 else "keyDate"


def _first(values: Any) -> Any:
    return next((value for value in values if value is not None), None)


def _event(
    members: list[RankedEvent], title: str, summary: str, personal_note: str | None
) -> ForecastEvent:
    """One forecast event from extracted events that share their dates. Only the three texts
    come from outside; everything else is built from the members."""
    first = members[0]
    planets = list(dict.fromkeys(p for m in members for p in m.verified.event.planets or []))
    # One window per source that states one; a source's first is kept.
    windows: dict[str, ActiveWindow] = {}
    for verified in (m.verified for m in members):
        if verified.active_from or verified.active_until:
            windows.setdefault(
                verified.url,
                ActiveWindow(
                    source_url=verified.url, start=verified.active_from, end=verified.active_until
                ),
            )
    return ForecastEvent(
        id=first.id,
        date=first.verified.date,
        end_date=first.verified.end_date,
        title=title,
        type=_merged_type(members),
        life_areas=list(dict.fromkeys(area for m in members for area in m.life_areas)),
        summary=summary,
        personal_note=personal_note or None,
        source_urls=list(dict.fromkeys(m.verified.url for m in members))[
            :MAX_SOURCE_URLS_PER_EVENT
        ],
        in_focus=any(m.rank is not None for m in members),
        planets=planets or None,
        aspect=_first(m.verified.event.aspect for m in members),
        house=_first(m.house for m in members),
        active_windows=list(windows.values())[:MAX_SOURCE_URLS_PER_EVENT] or None,
    )


def assemble_forecast(
    answer: Any, events: list[RankedEvent], personal_notes: bool = False
) -> tuple[list[str], MonthlyForecast | None]:
    """Build the forecast from the Synthesizer's answer. Returns (errors, forecast).

    Only an answer without a usable theme or group list is an error. Within it, what does not
    hold up is ignored and the events concerned are shown in the source's own words:
    - an id that does not exist, or was already used, is skipped;
    - of a group whose events do not all have the same dates, the largest part that does is
      merged (the earliest in `events` on a tie) and the other events are left out of it;
    - an event no accepted group refers to is appended with the Extractor's title and advice.
    Members of a group keep the order of `events`, and the first one gives the event its id.
    Personal notes are kept only when a life context was sent (`personal_notes`).
    """
    try:
        parsed = SynthesizerAnswer.model_validate(answer)
    except ValidationError as exc:
        return error_messages(exc), None

    by_id = {event.id: event for event in events}
    order = {event.id: index for index, event in enumerate(events)}
    used: set[str] = set()
    built: list[tuple[RankedEvent, ForecastEvent]] = []
    ignored = 0
    for raw in parsed.groups:
        try:
            group = SynthesizedGroup.model_validate(raw)
        except ValidationError:
            ignored += 1
            continue
        ids = [i for i in dict.fromkeys(group.event_ids) if i in by_id and i not in used]
        members = sorted((by_id[i] for i in ids), key=lambda member: order[member.id])
        if not members:
            ignored += 1
            continue
        same_dates: dict[tuple[str, str | None], list[RankedEvent]] = {}
        for member in members:
            same_dates.setdefault(member.dates, []).append(member)
        members = max(same_dates.values(), key=len)  # the first of the largest on a tie
        used.update(member.id for member in members)
        note = group.personal_note if personal_notes else None
        built.append((members[0], _event(members, group.title, group.summary, note)))
    if ignored:
        logger.warning("Synthesizer: %d group(s) ignored", ignored)

    for event in events:
        if event.id not in used:
            extracted = event.verified.event
            built.append((event, _event([event], extracted.title, extracted.advice, None)))

    built.sort(key=lambda pair: (pair[1].date, order[pair[0].id]))
    forecast_events = [event for _, event in built]
    return [], MonthlyForecast(
        theme=parsed.theme, events=forecast_events, ics_content=build_ics_calendar(forecast_events)
    )
