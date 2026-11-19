"""Pydantic models for every request, the language model's answers and every response.

The TypeScript types of the frontend are generated from these (`scripts/export_schema.py`).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Annotated, Any, Literal, get_args
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Discriminator,
    Field,
    Tag,
    TypeAdapter,
    ValidationError,
    model_validator,
)
from pydantic.alias_generators import to_camel

from .validation import (
    MAX_BIRTH_YEAR,
    MAX_EXCERPT_LENGTH,
    MAX_QUERY_LENGTH,
    MAX_SOURCE_URLS_PER_EVENT,
    MAX_SUMMARY_LENGTH,
    MAX_THEME_LENGTH,
    MAX_TITLE_LENGTH,
    MIN_BIRTH_YEAR,
    is_http_url,
    is_uuid,
    is_valid_birth_time,
    is_valid_time_zone,
    parse_iso_date,
    parse_month_range,
)

MAX_NAME_LENGTH = 120
MAX_LOCATION_LENGTH = 200
MAX_GOALS_LENGTH = 500
MAX_UPCOMING_EVENTS = 10
MAX_EVENT_LABEL_LENGTH = 120
MAX_PERSONAL_NOTE_LENGTH = 1000
MAX_USER_SOURCES = 10
MAX_ADVICE_LENGTH = 1000
MAX_QUOTE_LENGTH = 600
MAX_EXTRACTED_EVENTS = 60
MAX_SOURCE_URL_LENGTH = 500

ZodiacSign = Literal[
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

# The one taxonomy: profile focus, event tags, map rows and calendar text. House-based.
LifeArea = Literal[
    "career",
    "money",
    "love",
    "family",
    "health",
    "community",
    "communication",
    "learning",
    "creativity",
    "rest",
]
LIFE_AREAS: tuple[str, ...] = get_args(LifeArea)
LIFE_AREA_LABELS = {
    "career": "Career & Work",
    "money": "Money & Resources",
    "love": "Love & Relationships",
    "family": "Family & Home",
    "health": "Health & Wellbeing",
    "community": "Friends & Community",
    "communication": "Communication & Contracts",
    "learning": "Learning & Travel",
    "creativity": "Creativity & Fun",
    "rest": "Rest & Inner Life",
}

EventType = Literal["keyDate", "goodTime", "caution"]
EVENT_TYPES: tuple[str, ...] = get_args(EventType)
EVENT_TYPE_LABELS = {"keyDate": "Key date", "goodTime": "Good time", "caution": "Be careful"}


class ApiModel(BaseModel):
    """camelCase on the wire, no type coercion ("yes" is not a boolean), unknown fields ignored."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, strict=True, extra="ignore"
    )

    def to_json(self) -> dict[str, Any]:
        """The wire form: camelCase keys, unanswered optional fields left out."""
        return self.model_dump(by_alias=True, exclude_none=True)


_PROFILE_TAGS = ("general", "personal")


def error_messages(exc: ValidationError, prefix: str = "") -> list[str]:
    """Field path and problem for each error. The submitted value is never part of the text."""
    messages = []
    for error in exc.errors(include_url=False, include_input=False, include_context=False):
        path = prefix
        for part in error["loc"]:
            if isinstance(part, int):
                path += f"[{part}]"
            elif part not in _PROFILE_TAGS:
                path += f".{part}" if path else str(part)
        message = error["msg"].removeprefix("Value error, ")
        messages.append(f"{path}: {message}" if path else message)
    return messages


# --- field types ------------------------------------------------------------------------------


def _real_date(value: str) -> str:
    if not parse_iso_date(value):
        raise ValueError("must be a real YYYY-MM-DD date")
    return value


def _month(value: str) -> str:
    if not parse_month_range(value):
        raise ValueError('must be in "Month YYYY" format, e.g. "November 2026"')
    return value


def _time_zone(value: str) -> str:
    if not is_valid_time_zone(value):
        raise ValueError("must be a valid IANA timezone")
    return value


def _unique(items: list[Any]) -> list[Any]:
    if len(set(items)) != len(items):
        raise ValueError("must not contain duplicates")
    return items


def _text(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value.strip()


def _http_url(value: str) -> str:
    if not is_http_url(value):
        raise ValueError("must be an http(s) URL")
    return value


def _plain_http_url(value: str) -> str:
    parts = urlsplit(_http_url(value))
    if parts.username or parts.password:
        raise ValueError("must be a plain http(s) URL")
    return value


def _uuid(value: str) -> str:
    if not is_uuid(value):
        raise ValueError("must be a valid UUID")
    return value


def _not_null(value: Any) -> Any:
    if value is None:
        raise ValueError("must not be null")
    return value


def _blank_is_unanswered(value: Any) -> Any:
    return None if value == "" else value


IsoDate = Annotated[str, AfterValidator(_real_date)]
TargetMonth = Annotated[str, AfterValidator(_month)]
TimeZone = Annotated[str, Field(max_length=100), AfterValidator(_time_zone)]
FocusAreas = Annotated[list[LifeArea], Field(max_length=len(LIFE_AREAS)), AfterValidator(_unique)]
ProfileId = Annotated[str, AfterValidator(_uuid)]


def _bounded(max_length: int) -> Any:
    """A nonblank string of at most `max_length` characters; surrounding spaces are removed."""
    return Annotated[str, Field(max_length=max_length), AfterValidator(_text)]


# --- profile ----------------------------------------------------------------------------------

Relationship = Literal["single", "dating", "inRelationship", "married", "separated", "complicated"]
Work = Literal[
    "employed",
    "jobSeeking",
    "consideringChange",
    "selfEmployed",
    "student",
    "parentalLeave",
    "retired",
]
MoneyFocus = Literal["saving", "bigPurchase", "investing", "debt"]
KidsStage = Literal["none", "trying", "expecting", "under5", "age5to12", "teens", "adult"]
HealthFocus = Literal["fitness", "sleep", "stress", "nutrition", "habit"]


class UpcomingEvent(ApiModel):
    date: IsoDate
    label: _bounded(MAX_EVENT_LABEL_LENGTH)  # type: ignore[valid-type]


class LifeContext(ApiModel):
    """The user's situation. Every answer is optional. Reaches the Synthesizer as priorities, never the disk."""

    relationship: Annotated[Relationship | None, BeforeValidator(_blank_is_unanswered)] = None
    looking_for_partner: bool | None = None
    work: Annotated[Work | None, BeforeValidator(_blank_is_unanswered)] = None
    kids: Annotated[list[KidsStage], Field(max_length=7), AfterValidator(_unique)] | None = None
    caring_for_parents: bool | None = None
    money_focus: Annotated[MoneyFocus | None, BeforeValidator(_blank_is_unanswered)] = None
    health_focus: (
        Annotated[list[HealthFocus], Field(max_length=5), AfterValidator(_unique)] | None
    ) = None
    goals: Annotated[str, Field(max_length=MAX_GOALS_LENGTH), AfterValidator(str.strip)] | None = (
        None
    )
    upcoming_events: (
        Annotated[list[UpcomingEvent], Field(max_length=MAX_UPCOMING_EVENTS)] | None
    ) = None

    def answers(self) -> dict[str, Any]:
        """Only what was actually answered: no empty lists, blank texts or unticked boxes."""
        return {
            key: value
            for key, value in self.to_json().items()
            if value is not False and value != [] and value != ""
        }


class GeneralProfile(ApiModel):
    """A forecast for a sign: nothing else is asked, read or kept."""

    mode: Literal["general"]
    sun_sign: ZodiacSign
    target_month: TargetMonth
    focus_areas: FocusAreas = []


class PersonalProfile(ApiModel):
    mode: Literal["personal"] = "personal"
    name: Annotated[str, Field(max_length=MAX_NAME_LENGTH)]
    birth_date: IsoDate
    birth_time: str = ""
    has_exact_time: bool
    birth_location: Annotated[str, Field(max_length=MAX_LOCATION_LENGTH)]
    birth_timezone: TimeZone
    operating_timezone: TimeZone
    sun_sign: ZodiacSign
    moon_sign: ZodiacSign
    rising_sign: Annotated[ZodiacSign | None, BeforeValidator(_not_null)] = None
    use_rising_primary: bool
    target_month: TargetMonth
    focus_areas: FocusAreas = []
    life_context: LifeContext | None = None

    @model_validator(mode="after")
    def _check_birth_time(self) -> PersonalProfile:
        if self.has_exact_time and not is_valid_birth_time(self.birth_time):
            raise ValueError("birthTime must be a valid HH:mm time")
        if self.birth_time and not is_valid_birth_time(self.birth_time):
            raise ValueError("birthTime must be empty or a valid HH:mm time")
        return self

    def life_answers(self) -> dict[str, Any]:
        return self.life_context.answers() if self.life_context else {}

    def stored(self) -> dict[str, Any]:
        """What is written to disk: the profile without the life context."""
        return self.model_dump(by_alias=True, exclude_none=True, exclude={"life_context"})


def _profile_tag(value: Any) -> str | None:
    """Which profile model applies. A profile without a mode is a personal one."""
    mode = value.get("mode", "personal") if isinstance(value, dict) else getattr(value, "mode", "")
    return mode if isinstance(mode, str) else None


Profile = Annotated[
    Annotated[GeneralProfile, Tag("general")] | Annotated[PersonalProfile, Tag("personal")],
    Discriminator(
        _profile_tag,
        custom_error_type="invalid_profile",
        custom_error_message="must be an object whose mode is general or personal",
    ),
]
_PROFILE_ADAPTER: TypeAdapter[Any] = TypeAdapter(Profile)


def parse_profile(value: Any) -> GeneralProfile | PersonalProfile:
    """Validate a profile on its own. Raises pydantic.ValidationError."""
    return _PROFILE_ADAPTER.validate_python(value)


def stored_profile(profile: GeneralProfile | PersonalProfile) -> dict[str, Any]:
    return profile.stored() if isinstance(profile, PersonalProfile) else profile.to_json()


# --- requests ---------------------------------------------------------------------------------


class UserSourceRequest(ApiModel):
    url: Annotated[str, Field(max_length=MAX_SOURCE_URL_LENGTH), AfterValidator(_plain_http_url)]
    id: Annotated[str, Field(max_length=64)] = ""
    active: bool = True


class SourcesRequest(ApiModel):
    """The choices on the Sources tab. Active user sources are used instead of the default ones."""

    disabled_curated: Annotated[list[str], Field(max_length=50)] = []
    user: Annotated[list[UserSourceRequest], Field(max_length=MAX_USER_SOURCES)] = []
    include_curated: bool = False


class ProfileSaveRequest(ApiModel):
    profile: Profile
    profile_id: ProfileId | None = None


class SynthesizeRequest(ApiModel):
    profile: Profile
    profile_id: ProfileId | None = None
    custom_excerpt: Annotated[str, Field(max_length=MAX_EXCERPT_LENGTH)] | None = None
    sources: SourcesRequest | None = None


@dataclass(frozen=True)
class ChartRequest:
    birth_date: dt.date
    birth_time: dt.time | None
    timezone: str
    latitude: float | None
    longitude: float | None


class ChartPlace(ApiModel):
    tz: TimeZone
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)] | None = None
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)] | None = None

    @model_validator(mode="after")
    def _check_coordinates(self) -> ChartPlace:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon must be given together")
        return self


class ChartRequestBody(ApiModel):
    birth_date: IsoDate
    time_known: bool
    birth_time: str | None = None  # read only when the time is known
    place: ChartPlace

    @model_validator(mode="after")
    def _check(self) -> ChartRequestBody:
        year = int(self.birth_date[:4])
        if not MIN_BIRTH_YEAR <= year <= MAX_BIRTH_YEAR:
            raise ValueError(f"birthDate must be between {MIN_BIRTH_YEAR} and {MAX_BIRTH_YEAR}")
        if self.time_known and not is_valid_birth_time(self.birth_time):
            raise ValueError("birthTime must be a valid HH:mm time")
        return self

    def to_request(self) -> ChartRequest:
        birth_time = None
        if self.time_known and self.birth_time:
            birth_time = dt.time.fromisoformat(self.birth_time)
        return ChartRequest(
            dt.date.fromisoformat(self.birth_date),
            birth_time,
            self.place.tz,
            self.place.lat,
            self.place.lon,
        )


def validate_chart_request(body: Any) -> tuple[list[str], ChartRequest | None]:
    """Validate a /api/chart body. Returns (errors, request); request is None on errors."""
    try:
        return [], ChartRequestBody.model_validate(body).to_request()
    except ValidationError as exc:
        return error_messages(exc), None


# --- the language model's answers --------------------------------------------------------------


class AgentQuery(ApiModel):
    query: _bounded(MAX_QUERY_LENGTH)  # type: ignore[valid-type]


Tone = Literal["favourable", "caution", "neutral"]
TONE_EVENT_TYPES: dict[str, str] = {
    "favourable": "goodTime",
    "caution": "caution",
    "neutral": "keyDate",
}

Planet = Literal[
    "Sun",
    "Moon",
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
    "Chiron",
    "North Node",
    "South Node",
]
PLANETS: tuple[str, ...] = get_args(Planet)
Aspect = Literal[
    "newMoon",
    "fullMoon",
    "solarEclipse",
    "lunarEclipse",
    "ingress",
    "retrograde",
    "direct",
    "conjunction",
    "opposition",
    "square",
    "trine",
    "sextile",
]
ASPECTS: tuple[str, ...] = get_args(Aspect)
ZODIAC: tuple[str, ...] = get_args(ZodiacSign)


def _known_planets(value: Any) -> Any:
    """The planets the app knows, each once; anything else is left out instead of failing."""
    if not isinstance(value, list):
        return None
    names = {name.lower(): name for name in PLANETS}
    found = [names.get(item.strip().lower()) for item in value if isinstance(item, str)]
    return list(dict.fromkeys(name for name in found if name)) or None


def _known(options: tuple[str, ...]) -> Any:
    """An optional detail: a value outside `options` counts as not given."""
    return BeforeValidator(lambda value: value if value in options else None)


def _known_house(value: Any) -> Any:
    return value if type(value) is int and 1 <= value <= 12 else None


def _known_date(value: Any) -> Any:
    return value if parse_iso_date(value) else None


def _known_life_areas(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    return list(dict.fromkeys(item for item in value if item in LIFE_AREAS))


Planets = Annotated[list[Planet] | None, BeforeValidator(_known_planets)]
OptionalAspect = Annotated[Aspect | None, _known(ASPECTS)]
House = Annotated[int | None, BeforeValidator(_known_house)]
LifeAreaTags = Annotated[
    list[LifeArea], Field(min_length=1, max_length=len(LIFE_AREAS)), AfterValidator(_unique)
]
PersonalNote = Annotated[str, Field(max_length=MAX_PERSONAL_NOTE_LENGTH), AfterValidator(str.strip)]


class ExtractedEvent(ApiModel):
    """One dated event as the Extractor found it in one document. Checked against the text."""

    date: IsoDate  # a sky event: the exact day; a period: its first day
    end_date: IsoDate | None = None  # a period only: its inclusive last day
    # A sky event only: the days the source says it is felt, around its date.
    active_from: Annotated[str | None, BeforeValidator(_known_date)] = None
    active_until: Annotated[str | None, BeforeValidator(_known_date)] = None
    title: _bounded(MAX_TITLE_LENGTH)  # type: ignore[valid-type]
    advice: _bounded(MAX_ADVICE_LENGTH)  # type: ignore[valid-type]
    tone: Tone
    life_areas: Annotated[LifeAreaTags, BeforeValidator(_known_life_areas)]
    quote: _bounded(MAX_QUOTE_LENGTH)  # type: ignore[valid-type]
    planets: Planets = None
    aspect: OptionalAspect = None
    house: House = None
    in_sign: Annotated[ZodiacSign | None, _known(ZODIAC)] = None


class ExtractorAnswer(ApiModel):
    """The Extractor's answer for one document. Each event is validated on its own."""

    events: Annotated[list[Any], Field(max_length=MAX_EXTRACTED_EVENTS)]


class SynthesizedGroup(ApiModel):
    """The Synthesizer's wording for one event: one or more extracted events, named by id."""

    event_ids: Annotated[list[str], Field(min_length=1, max_length=MAX_SOURCE_URLS_PER_EVENT)]
    title: _bounded(MAX_TITLE_LENGTH)  # type: ignore[valid-type]
    summary: _bounded(MAX_SUMMARY_LENGTH)  # type: ignore[valid-type]
    personal_note: PersonalNote | None = None


class SynthesizerAnswer(ApiModel):
    theme: _bounded(MAX_THEME_LENGTH)  # type: ignore[valid-type]
    groups: list[Any]  # each one is validated on its own


# --- responses --------------------------------------------------------------------------------


class ActiveWindow(ApiModel):
    """The days one source says an event is felt, around its date. The dates are not checked
    against the text; a side is kept only when the source's quote names that day or counts days."""

    source_url: Annotated[str, AfterValidator(_http_url)]
    start: IsoDate | None = None  # first day, when it is before the event's date
    end: IsoDate | None = None  # inclusive last day, when it is after the event's date


class ForecastEvent(ApiModel):
    """One event of the forecast. Dates, type, life areas and citations come from the extracted
    events it is built from; only the title, summary and personal note are the Synthesizer's."""

    id: str  # from the source, dates and quote of the extracted event: stable across regeneration
    date: IsoDate
    end_date: IsoDate | None = None  # inclusive last day
    title: _bounded(MAX_TITLE_LENGTH)  # type: ignore[valid-type]
    type: EventType
    life_areas: LifeAreaTags
    summary: _bounded(MAX_SUMMARY_LENGTH)  # type: ignore[valid-type]
    personal_note: PersonalNote | None = None
    source_urls: Annotated[
        list[Annotated[str, AfterValidator(_http_url)]],
        Field(min_length=1, max_length=MAX_SOURCE_URLS_PER_EVENT),
    ]
    in_focus: bool = False  # touches one of the user's priorities
    planets: list[Planet] | None = None
    aspect: Aspect | None = None
    house: Annotated[int, Field(ge=1, le=12)] | None = None  # counted from the reading sign
    active_windows: list[ActiveWindow] | None = None  # per source that states one


class MonthlyForecast(ApiModel):
    theme: str
    events: list[ForecastEvent]
    ics_content: str


class SourceReport(ApiModel):
    """What happened to one source while a forecast was generated."""

    id: str
    name: str
    url: str
    origin: Literal["curated", "user", "web"]
    status: Literal["used", "no_forecast", "failed"]
    reason: str | None = None
    documents: int
    events: int | None = None  # events found in it that passed the check against its text
    dropped: int | None = None  # events the Extractor returned that failed that check


class Evidence(ApiModel):
    mode: Literal["user", "curated", "web"]
    gap: bool  # true when no source had anything for the month


class ForecastResponse(ApiModel):
    result: MonthlyForecast
    profile_id: str
    sources: list[SourceReport]
    evidence: Evidence


class ChartResponse(ApiModel):
    sun: ZodiacSign
    moon: ZodiacSign
    rising: ZodiacSign | None = None  # only with a known time and a birth place
    sun_uncertain: bool  # birth time unknown and the sign changed that day
    moon_uncertain: bool


class Place(ApiModel):
    label: str
    name: str
    region: str
    country: str
    lat: float
    lon: float
    tz: str


class PlacesResponse(ApiModel):
    results: list[Place]


class CuratedSourceInfo(ApiModel):
    id: str
    name: str
    author: str
    type: Literal["video", "website"]
    url: str
    language: str
    cadence: str


class CuratedSourcesResponse(ApiModel):
    sources: list[CuratedSourceInfo]


class ProfileSaveResponse(ApiModel):
    profile_id: str


class ErrorResponse(ApiModel):
    error: str


# The models the frontend types are generated from, with the direction they travel in.
SCHEMA_MODELS: tuple[tuple[type[BaseModel], Literal["validation", "serialization"]], ...] = (
    (ProfileSaveRequest, "validation"),
    (SynthesizeRequest, "validation"),
    (ChartRequestBody, "validation"),
    (ForecastResponse, "serialization"),
    (ChartResponse, "serialization"),
    (PlacesResponse, "serialization"),
    (CuratedSourcesResponse, "serialization"),
    (ProfileSaveResponse, "serialization"),
    (ErrorResponse, "serialization"),
)
