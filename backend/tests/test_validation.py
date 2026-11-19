import pytest
from pydantic import ValidationError

from app.models import (
    ASPECTS,
    EVENT_TYPE_LABELS,
    EVENT_TYPES,
    LIFE_AREA_LABELS,
    LIFE_AREAS,
    PLANETS,
    TONE_EVENT_TYPES,
    error_messages,
    parse_profile,
    stored_profile,
)
from app.prompts import EXTRACTOR_PROMPT, SYNTHESIZER_PROMPT
from app.validation import (
    inclusive_day_span,
    parse_llm_json,
    parse_month_range,
    primary_sign,
)

from .helpers import VALID_PROFILE


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
        assert f"- {area}:" in EXTRACTOR_PROMPT
    for event_type in EVENT_TYPES:
        assert f"{event_type}:" in SYNTHESIZER_PROMPT
    # The Extractor reports the source's tone; code turns it into the event type.
    assert tuple(TONE_EVENT_TYPES.values()) == ("goodTime", "caution", "keyDate")
    for tone in TONE_EVENT_TYPES:
        assert f'"{tone}"' in EXTRACTOR_PROMPT
    for name in (*PLANETS, *ASPECTS):
        assert name in EXTRACTOR_PROMPT


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
