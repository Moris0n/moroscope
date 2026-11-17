import pytest

from app.validation import (
    inclusive_day_span,
    parse_llm_json,
    parse_month_range,
    sanitize_profile,
    validate_forecast_payload,
    validate_user_profile,
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


def test_validate_user_profile_accepts_valid_profiles():
    assert validate_user_profile(VALID_PROFILE) == []
    assert validate_user_profile({**VALID_PROFILE, "hasExactTime": False, "birthTime": ""}) == []
    without_optional = {
        k: v for k, v in VALID_PROFILE.items() if k not in ("risingSign", "backendUrl")
    }
    assert validate_user_profile(without_optional) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"targetMonth": "Nov 2026"},
        {"priorities": ["bogus"]},
        {"priorities": ["careerTransition", "careerTransition"]},
        {"priorities": [{"nested": 1}]},
        {"birthDate": "1994-02-30"},
        {"name": ""},
        {"name": "x" * 121},
        {"sunSign": "NotASign"},
        {"moonSign": None},
        {"risingSign": None},
        {"birthTime": "25:99"},
        {"hasExactTime": False, "birthTime": "8:45"},
        {"operatingTimezone": "Mars/Olympus"},
        {"birthTimezone": "../../etc/passwd"},
        {"activeCategories": []},
        {"activeCategories": ["career", "madeUp"]},
        {"hasExactTime": "yes"},
        {"useRisingPrimary": 1},
        {"backendUrl": "https://x/y?key=1"},
    ],
)
def test_validate_user_profile_enforces_the_schema(overrides):
    assert validate_user_profile({**VALID_PROFILE, **overrides}) != []


@pytest.mark.parametrize("not_a_profile", [None, [], "profile", 5])
def test_validate_user_profile_rejects_non_objects(not_a_profile):
    assert validate_user_profile(not_a_profile) == ["profile must be an object"]


def test_sanitize_profile_allowlists_fields_and_drops_backend_url():
    out = sanitize_profile(
        {**VALID_PROFILE, "backendUrl": "https://evil.example", "admin": True, "nested": {"bad": 1}}
    )
    assert "backendUrl" not in out and "admin" not in out and "nested" not in out
    assert out["name"] == "Test User"
    assert out["targetMonth"] == "November 2026"


def _forecast_errors(payload, priorities=None):
    errors, result = validate_forecast_payload(
        payload,
        parse_month_range("November 2026"),
        VALID_PROFILE["priorities"] if priorities is None else priorities,
        {r["url"] for r in TAVILY_RESULTS},
    )
    assert (result is None) == bool(errors)
    return errors


@pytest.mark.parametrize(
    "event",
    [
        valid_event(date="2025-11-05"),
        valid_event(date="2026-11-31"),
        valid_event(date="2026-11-10", end_date="2026-11-09"),
        valid_event(date="2026-11-29", end_date="2026-12-02"),
        valid_event(topics=["lottery"]),
        valid_event(topics=["datingRomance"]),
        valid_event(topics=[]),
        valid_event(source_urls=["https://fabricated.example/x"]),
        valid_event(source_urls=[]),
        valid_event(impact_type="Doom"),
        valid_event(title="  "),
        valid_event(summary="x" * 4001),
        "not an object",
    ],
)
def test_validate_forecast_payload_rejects_bad_events(event):
    assert _forecast_errors(valid_forecast(events=[event]))


def test_validate_forecast_payload_rejects_bad_envelopes_and_ordering():
    assert _forecast_errors([]) == ["forecast must be a JSON object"]
    assert _forecast_errors({"overall_theme": "t"})
    assert _forecast_errors(valid_forecast(overall_theme=""))
    assert _forecast_errors(valid_forecast(events=[valid_event()] * 61))
    out_of_order = [valid_event(date="2026-11-10"), valid_event(date="2026-11-05")]
    assert _forecast_errors(valid_forecast(events=out_of_order))


def test_validate_forecast_payload_returns_trimmed_events():
    errors, result = validate_forecast_payload(
        valid_forecast(
            overall_theme="  Theme  ",
            events=[
                valid_event(title=" Padded ", end_date="2026-11-07"),
                valid_event(end_date=None),
            ],
        ),
        parse_month_range("November 2026"),
        VALID_PROFILE["priorities"],
        {r["url"] for r in TAVILY_RESULTS},
    )
    assert errors == []
    assert result["overall_theme"] == "Theme"
    assert result["events"][0]["title"] == "Padded"
    assert result["events"][0]["end_date"] == "2026-11-07"
    assert "end_date" not in result["events"][1]
    assert (
        _forecast_errors(valid_forecast(events=[valid_event(topics=["datingRomance"])]), []) == []
    )


def test_parse_llm_json_accepts_fenced_json_but_never_repairs():
    assert parse_llm_json('{"a":1}') == {"a": 1}
    assert parse_llm_json('```json\n{"a":1}\n```') == {"a": 1}
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
