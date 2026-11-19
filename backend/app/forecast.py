"""From the forecast agent's answer to the forecast the app shows: context rules and event ids."""

from __future__ import annotations

import hashlib
from typing import Any

from pydantic import ValidationError

from .ics import build_ics_calendar
from .models import AgentEvent, AgentForecast, ForecastEvent, MonthlyForecast, error_messages
from .validation import MonthRange


def event_id(month_key: str, event: AgentEvent) -> str:
    """The same for the same month, dates, title and type, whatever else the model rewrote."""
    source = "|".join((month_key, event.date, event.end_date or "", event.title, event.type))
    return hashlib.sha256(source.encode("utf-8")).hexdigest()[:12]


def empty_forecast(theme: str) -> MonthlyForecast:
    return MonthlyForecast(theme=theme, events=[], ics_content=build_ics_calendar([]))


def validate_forecast_payload(
    payload: Any,
    month: MonthRange,
    focus_areas: list[str],
    allowed_source_urls: set[str],
    personal_notes: bool = False,
) -> tuple[list[str], MonthlyForecast | None]:
    """Check the forecast agent's answer. Returns (errors, forecast); forecast is None on errors.

    The shape is checked by the model. Here: dates within the month, citations only to the
    documents that were sent, chronological order, and one chosen focus area per event. Personal
    notes are kept only when a life context was sent (`personal_notes`).
    """
    try:
        answer = AgentForecast.model_validate(payload)
    except ValidationError as exc:
        return error_messages(exc), None

    month_key = f"{month.year}-{month.month:02d}"
    errors: list[str] = []
    events: list[ForecastEvent] = []
    seen: dict[str, int] = {}
    previous = ""
    for index, event in enumerate(answer.events):
        label = f"events[{index}]"
        # ISO dates compare correctly as strings.
        if not month.first_date <= event.date <= month.last_date:
            errors.append(f"{label}.date is outside the target month")
        if event.end_date is not None:
            if event.end_date < event.date:
                errors.append(f"{label}.endDate must be >= date")
            if event.end_date > month.last_date:
                errors.append(f"{label}.endDate is outside the target month")
        if focus_areas and not set(event.life_areas) & set(focus_areas):
            errors.append(f"{label}.lifeAreas must include at least one chosen focus area")
        if not set(event.source_urls) <= allowed_source_urls:
            errors.append(f"{label}.sourceUrls contains a URL that is not among the documents")
        if event.date < previous:
            errors.append(f"{label} is out of chronological order")
        previous = event.date

        base = event_id(month_key, event)
        seen[base] = seen.get(base, 0) + 1
        fields = event.model_dump()
        fields["personal_note"] = (personal_notes and event.personal_note) or None
        events.append(
            ForecastEvent(id=base if seen[base] == 1 else f"{base}-{seen[base]}", **fields)
        )

    if errors:
        return errors, None
    return [], MonthlyForecast(
        theme=answer.theme, events=events, ics_content=build_ics_calendar(events)
    )
