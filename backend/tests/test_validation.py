import re

import pytest
from pydantic import ValidationError

from app.forecast import validate_forecast_payload
from app.models import (
    EVENT_TYPE_LABELS,
    EVENT_TYPES,
    LIFE_AREA_LABELS,
    LIFE_AREAS,
    error_messages,
    parse_profile,
    stored_profile,
)
from app.prompts import FORECAST_AGENT_PROMPT
from app.validation import (
    inclusive_day_span,
    parse_llm_json,
    parse_month_range,
    primary_sign,
)

from .helpers import TAVILY_RESULTS, VALID_PROFILE, valid_event, valid_forecast


def test_parse_month_range_accepts_strict_month_year_and_computes_bounds():
    nov = parse_month_range("November 2026")
    assert nov is not None
    assert (nov.first_date, nov.last_date, nov.days_in_month) == ("2026-11-01", "2026-11-30", 30)

    leap = parse_month_range("February 2028")
    assert (leap.days_in_month, leap.last_date) == (29, "2028-02-29")
    assert parse_month_range("February 2027").days_in_month == 28


@pytest.mark.parametrize(
    "bad",
    [
        "Nov 2026",
        "2026-11",
        "November 26",
        "november 2026",
        "November  2026 extra",
        "Smarch 2026",
        "November ２０２６",
        "",
        202611,
        None,
    ],
)
def test_parse_month_range_rejects_malformed_input(bad):
    assert parse_month_range(bad) is None


def profile_errors(profile):
    try:
        parse_profile(profile)
    except ValidationError as exc:
        return error_messages(exc, "profile")
    return []


def test_valid_profiles_are_accepted():
    assert profile_errors(VALID_PROFILE) == []
    assert profile_errors({**VALID_PROFILE, "hasExactTime": False, "birthTime": ""}) == []
    without_optional = {
        k: v
        for k, v in VALID_PROFILE.items()
        if k not in ("risingSign", "backendUrl", "focusAreas")
    }
    assert profile_errors(without_optional) == []
    # A connection setting of the browser: not part of the profile, so not looked at.
    assert profile_errors({**VALID_PROFILE, "backendUrl": "https://x/y?key=1"}) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"targetMonth": "Nov 2026"},
        {"focusAreas": ["bogus"]},
        {"focusAreas": ["careerTransition"]},
        {"focusAreas": ["career", "career"]},
        {"focusAreas": [{"nested": 1}]},
        {"focusAreas": "career"},
        {"birthDate": "1994-02-30"},
        {"name": None},
        {"name": "x" * 121},
        {"mode": "anonymous"},
        {"lifeContext": "single"},
        {"lifeContext": {"relationship": "royal"}},
        {"lifeContext": {"kids": ["under5", "under5"]}},
        {"lifeContext": {"kids": "under5"}},
        {"lifeContext": {"lookingForPartner": "yes"}},
        {"lifeContext": {"goals": "x" * 501}},
        {"lifeContext": {"upcomingEvents": [{"date": "2026-11-31", "label": "Move"}]}},
        {"lifeContext": {"upcomingEvents": [{"date": "2026-11-16", "label": " "}]}},
        {"lifeContext": {"upcomingEvents": [{"date": "2026-11-16", "label": "x"}] * 11}},
        {"sunSign": "NotASign"},
        {"moonSign": None},
        {"risingSign": None},
        {"birthTime": "25:99"},
        {"hasExactTime": False, "birthTime": "8:45"},
        {"operatingTimezone": "Mars/Olympus"},
        {"birthTimezone": "../../etc/passwd"},
        {"hasExactTime": "yes"},
        {"useRisingPrimary": 1},
    ],
)
def test_the_profile_schema_is_enforced(overrides):
    assert profile_errors({**VALID_PROFILE, **overrides}) != []


@pytest.mark.parametrize("not_a_profile", [None, [], "profile", 5])
def test_non_objects_are_not_profiles(not_a_profile):
    assert profile_errors(not_a_profile) == [
        "profile: must be an object whose mode is general or personal"
    ]


def test_errors_name_the_field_and_never_repeat_the_submitted_value():
    errors = profile_errors(
        {
            **VALID_PROFILE,
            "name": "Secret Name " * 20,
            "birthDate": "1994-13-45",
            "lifeContext": {
                "goals": 7,
                "upcomingEvents": [{"date": "soon", "label": "My wedding"}],
            },
        }
    )
    assert [e.split(":")[0] for e in errors] == [
        "profile.name",
        "profile.birthDate",
        "profile.lifeContext.goals",
        "profile.lifeContext.upcomingEvents[0].date",
    ]
    text = " ".join(errors)
    for secret in ("Secret Name", "1994-13-45", "soon", "My wedding"):
        assert secret not in text


def test_the_stored_profile_keeps_known_fields_only():
    profile = parse_profile(
        {**VALID_PROFILE, "backendUrl": "https://evil.example", "admin": True, "nested": {"bad": 1}}
    )
    out = stored_profile(profile)
    assert "backendUrl" not in out and "admin" not in out and "nested" not in out
    assert out["name"] == "Test User"
    assert out["targetMonth"] == "November 2026"
    assert out["focusAreas"] == ["career", "money"]
    assert parse_profile(out) == profile


def test_the_taxonomy_has_ten_life_areas_and_three_event_types_with_labels():
    assert LIFE_AREAS == (
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
    )
    assert set(LIFE_AREA_LABELS) == set(LIFE_AREAS)
    assert EVENT_TYPES == ("keyDate", "goodTime", "caution")
    assert set(EVENT_TYPE_LABELS) == set(EVENT_TYPES)
    for area in LIFE_AREAS:
        assert f"- {area}:" in FORECAST_AGENT_PROMPT
    for event_type in EVENT_TYPES:
        assert f"- {event_type}:" in FORECAST_AGENT_PROMPT


NOVEMBER = parse_month_range("November 2026")
URLS = {r["url"] for r in TAVILY_RESULTS}


def _forecast_errors(payload, focus_areas=None):
    errors, result = validate_forecast_payload(
        payload, NOVEMBER, VALID_PROFILE["focusAreas"] if focus_areas is None else focus_areas, URLS
    )
    assert (result is None) == bool(errors)
    return errors


@pytest.mark.parametrize(
    "event",
    [
        valid_event(date="2025-11-05"),
        valid_event(date="2026-11-31"),
        valid_event(date="2026-11-10", endDate="2026-11-09"),
        valid_event(date="2026-11-29", endDate="2026-12-02"),
        valid_event(lifeAreas=["lottery"]),
        valid_event(lifeAreas=["love"]),
        valid_event(lifeAreas=["career", "career"]),
        valid_event(lifeAreas=[]),
        valid_event(sourceUrls=["https://fabricated.example/x"]),
        valid_event(sourceUrls=[]),
        valid_event(type="Doom"),
        valid_event(type="Opportunity"),
        valid_event(title="  "),
        valid_event(summary="x" * 4001),
        valid_event(personalNote="x" * 1001),
        valid_event(personalNote=5),
        "not an object",
    ],
)
def test_validate_forecast_payload_rejects_bad_events(event):
    assert _forecast_errors(valid_forecast(events=[event]))


def test_validate_forecast_payload_rejects_bad_envelopes_and_ordering():
    assert _forecast_errors([])
    assert _forecast_errors({"theme": "t"})
    assert _forecast_errors({"overall_theme": "t", "events": []})
    assert _forecast_errors(valid_forecast(theme=""))
    assert _forecast_errors(valid_forecast(events=[valid_event()] * 61))
    out_of_order = [valid_event(date="2026-11-10"), valid_event(date="2026-11-05")]
    assert _forecast_errors(valid_forecast(events=out_of_order))


def test_validate_forecast_payload_returns_trimmed_events_and_a_calendar():
    errors, result = validate_forecast_payload(
        valid_forecast(
            theme="  Theme  ",
            events=[
                valid_event(title=" Padded ", endDate="2026-11-07"),
                valid_event(endDate=None, lifeAreas=["money", "rest"]),
            ],
        ),
        NOVEMBER,
        VALID_PROFILE["focusAreas"],
        URLS,
    )
    assert errors == []
    out = result.to_json()
    assert out["theme"] == "Theme"
    assert out["events"][0]["title"] == "Padded"
    assert out["events"][0]["endDate"] == "2026-11-07"
    assert "endDate" not in out["events"][1] and "personalNote" not in out["events"][1]
    assert out["icsContent"].count("BEGIN:VEVENT") == 2
    assert _forecast_errors(valid_forecast(events=[valid_event(lifeAreas=["love"])]), []) == []


def test_personal_notes_are_kept_only_when_a_life_context_was_sent():
    payload = valid_forecast(
        events=[valid_event(personalNote="  Good day for your interview.  "), valid_event()]
    )
    _, general = validate_forecast_payload(payload, NOVEMBER, [], URLS)
    assert [e.personal_note for e in general.events] == [None, None]
    assert "interview" not in general.ics_content

    _, personal = validate_forecast_payload(payload, NOVEMBER, [], URLS, personal_notes=True)
    assert [e.personal_note for e in personal.events] == ["Good day for your interview.", None]
    assert "For you: Good day for your interview." in personal.ics_content.replace("\r\n ", "")
    blank = valid_forecast(events=[valid_event(personalNote="   ")])
    _, result = validate_forecast_payload(blank, NOVEMBER, [], URLS, personal_notes=True)
    assert "personalNote" not in result.to_json()["events"][0]


def test_event_ids_are_stable_for_the_same_event_and_unique_within_a_forecast():
    events = [
        valid_event(),
        valid_event(summary="Reworded by the model.", lifeAreas=["money"]),
        valid_event(title="Another title"),
        valid_event(date="2026-11-06"),
    ]

    def ids(payload, month=NOVEMBER):
        errors, result = validate_forecast_payload(payload, month, [], URLS)
        assert errors == []
        return [e.id for e in result.events]

    first = ids(valid_forecast(events=events))
    assert first[1] == f"{first[0]}-2", (
        "same month, dates, title and type: a suffix tells them apart"
    )
    assert len(set(first)) == 4
    assert all(re.fullmatch(r"[0-9a-f]{12}(-\d+)?", i) for i in first)
    # The id is the server's: one sent by the model is ignored, and regenerating keeps it.
    again = ids(valid_forecast(theme="Other words", events=[valid_event(id="model-made")]))
    assert again == first[:1]
    december = valid_forecast(
        events=[valid_event(date="2026-12-05", sourceUrls=["https://astro.example/nov-2026"])]
    )
    assert ids(december, parse_month_range("December 2026")) != first[:1]


def test_parse_llm_json_accepts_fenced_json_but_never_repairs():
    assert parse_llm_json('{"a":1}') == {"a": 1}
    assert parse_llm_json('```json\n{"a":1}\n```') == {"a": 1}
    # Wrappers a reasoning model may add around the answer are removed.
    assert parse_llm_json('<think>{"draft": 1} hmm</think>\n{"a":1}') == {"a": 1}
    assert parse_llm_json('Here is the forecast:\n```json\n{"a":1}\n```\nDone.') == {"a": 1}
    assert parse_llm_json('Sure! {"a": {"b": "}"}} Hope it helps.') == {"a": {"b": "}"}}
    with pytest.raises(ValueError):
        parse_llm_json('{"a":')
    with pytest.raises(ValueError):
        parse_llm_json('{"a": NaN}')


def test_inclusive_day_span():
    assert inclusive_day_span("2026-11-05", "2026-11-07") == [
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
    ]
    assert inclusive_day_span("2026-11-07", "2026-11-05") == []


def test_personal_profiles_may_be_nameless_and_carry_a_life_context():
    context = {
        "relationship": "married",
        "lookingForPartner": False,
        "work": "selfEmployed",
        "kids": ["trying", "expecting", "teens"],
        "caringForParents": True,
        "moneyFocus": "bigPurchase",
        "healthFocus": ["stress"],
        "goals": "Move house",
        "upcomingEvents": [{"date": "2026-11-20", "label": "Moving day"}],
    }
    raw = {**VALID_PROFILE, "mode": "personal", "name": "", "lifeContext": context}
    profile = parse_profile(raw)
    assert parse_profile({**VALID_PROFILE, "lifeContext": {}}).life_answers() == {}
    assert parse_profile({**VALID_PROFILE, "lifeContext": None}).life_answers() == {}
    assert "lifeContext" not in stored_profile(profile)
    assert profile.life_answers() == {k: v for k, v in context.items() if v is not False}
    unanswered = {"moneyFocus": "", "goals": " ", "kids": [], "relationship": None}
    assert parse_profile({**raw, "lifeContext": unanswered}).life_answers() == {}


def test_general_profiles_need_only_a_sign_and_keep_nothing_else():
    general = {
        "mode": "general",
        "sunSign": "Leo",
        "targetMonth": "November 2026",
        "focusAreas": [],
    }
    assert profile_errors(general) == []
    assert profile_errors({"mode": "general", "sunSign": "Leo", "targetMonth": "May 2027"}) == []
    assert profile_errors({**general, "sunSign": "Lion"}) != []
    assert profile_errors({**general, "targetMonth": "soon"}) != []
    full = parse_profile({**VALID_PROFILE, **general, "lifeContext": {"goals": "x"}})
    assert stored_profile(full) == general
    assert not hasattr(full, "life_context")
    assert primary_sign(full) == ("Leo", "chosen")


def test_primary_sign_is_the_rising_sign_only_when_it_leads():
    def sign(**overrides):
        return primary_sign(parse_profile({**VALID_PROFILE, **overrides}))

    assert sign() == ("Scorpio", "rising")
    assert sign(useRisingPrimary=False) == ("Libra", "sun")
    assert sign(hasExactTime=False) == ("Libra", "sun")
    no_rising = {k: v for k, v in VALID_PROFILE.items() if k != "risingSign"}
    assert primary_sign(parse_profile(no_rising)) == ("Libra", "sun")


def test_children_answers_include_childless_and_trying():
    for kids in (["none"], ["none", "trying"], ["trying", "under5"]):
        assert profile_errors({**VALID_PROFILE, "lifeContext": {"kids": kids}}) == []


def test_the_committed_schema_matches_the_models():
    """The frontend types are generated from this file: `npm run gen:types` after a model change."""
    import importlib.util
    from pathlib import Path

    script = Path(__file__).resolve().parents[1] / "scripts" / "export_schema.py"
    spec = importlib.util.spec_from_file_location("export_schema", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.SCHEMA_PATH.read_text(encoding="utf-8") == module.render()
