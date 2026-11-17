from datetime import date, time
from pathlib import Path

import pytest

from app.chart import ChartCalculator, ascendant_longitude, sign_of
from app.config import PipelineError
from app.places import normalize, search_places
from app.validation import ChartRequest, validate_chart_request

from .helpers import api_client, make_deps

CALCULATOR = ChartCalculator()
HONOLULU = ("Pacific/Honolulu", 21.3069, -157.8583)
NEW_YORK = {"tz": "America/New_York", "lat": 40.7143, "lon": -74.006}
CHART_BODY = {
    "birthDate": "1994-10-17",
    "birthTime": "08:45",
    "timeKnown": True,
    "place": NEW_YORK,
}


def big_three(request: ChartRequest) -> tuple[str, str, str | None]:
    chart = CALCULATOR.compute(request)
    return chart["sun"], chart["moon"], chart.get("rising")


@pytest.mark.parametrize(
    ("request_", "expected"),
    [
        # Published charts (birth-certificate times).
        (ChartRequest(date(1961, 8, 4), time(19, 24), *HONOLULU), ("Leo", "Gemini", "Aquarius")),
        (
            ChartRequest(date(1961, 7, 1), time(19, 45), "Europe/London", 52.8311, 0.5142),
            ("Cancer", "Aquarius", "Sagittarius"),
        ),
        (
            ChartRequest(
                date(1955, 2, 24), time(19, 15), "America/Los_Angeles", 37.7749, -122.4194
            ),
            ("Pisces", "Aries", "Virgo"),
        ),
        (
            ChartRequest(date(1967, 6, 20), time(15, 15), *HONOLULU),
            ("Gemini", "Sagittarius", "Scorpio"),
        ),
    ],
)
def test_big_three_matches_published_charts(request_, expected):
    assert big_three(request_) == expected


def test_rising_needs_both_a_birth_time_and_coordinates():
    known_time_no_place = ChartRequest(
        date(1994, 10, 17), time(8, 45), "America/New_York", None, None
    )
    assert "rising" not in CALCULATOR.compute(known_time_no_place)
    no_time = ChartRequest(date(1994, 10, 17), None, "America/New_York", 40.7143, -74.006)
    assert "rising" not in CALCULATOR.compute(no_time)


def test_unknown_birth_time_flags_signs_that_changed_during_the_day():
    # The Moon entered Aries at about 05:00 New York time on 17 Oct 1994; the Sun stayed in Libra.
    moon_changes = CALCULATOR.compute(
        ChartRequest(date(1994, 10, 17), None, "America/New_York", None, None)
    )
    assert moon_changes["moonUncertain"] is True
    assert moon_changes["sunUncertain"] is False
    # The Sun entered Scorpio at about 15:35 UTC on 23 Oct 1994.
    sun_changes = CALCULATOR.compute(ChartRequest(date(1994, 10, 23), None, "UTC", None, None))
    assert sun_changes["sunUncertain"] is True
    steady = CALCULATOR.compute(ChartRequest(date(1994, 10, 18), None, "UTC", None, None))
    assert (steady["sunUncertain"], steady["moonUncertain"]) == (False, False)


def test_a_known_birth_time_is_never_flagged_uncertain():
    chart = CALCULATOR.compute(ChartRequest(date(1994, 10, 23), time(12, 0), "UTC", None, None))
    assert (chart["sunUncertain"], chart["moonUncertain"]) == (False, False)


def test_the_birth_timezone_changes_the_instant():
    # 23 Oct 1994: the Sun entered Scorpio at about 15:35 UTC.
    def sun_at_three_pm(tz: str) -> str:
        return big_three(ChartRequest(date(1994, 10, 23), time(15, 0), tz, None, None))[0]

    assert sun_at_three_pm("UTC") == "Libra"
    assert sun_at_three_pm("Asia/Tokyo") == "Libra"
    assert sun_at_three_pm("America/New_York") == "Scorpio"


def test_sign_and_ascendant_helpers():
    assert sign_of(0) == "Aries"
    assert sign_of(29.999) == "Aries"
    assert sign_of(30) == "Taurus"
    assert sign_of(359.9) == "Pisces"
    assert sign_of(-1) == "Pisces"
    # At 0h sidereal time on the equator, 0° Cancer rises.
    assert ascendant_longitude(0, 23.44, 0) == pytest.approx(90)


def test_a_missing_ephemeris_is_a_clear_503():
    with pytest.raises(PipelineError) as raised:
        ChartCalculator(Path("/nonexistent/de421.bsp")).compute(
            ChartRequest(date(1994, 10, 17), None, "UTC", None, None)
        )
    assert raised.value.status == 503
    assert "fetch_ephemeris" in raised.value.message


def test_validate_chart_request():
    errors, parsed = validate_chart_request(CHART_BODY)
    assert errors == []
    assert parsed == ChartRequest(
        date(1994, 10, 17), time(8, 45), "America/New_York", 40.7143, -74.006
    )

    _, no_time = validate_chart_request({**CHART_BODY, "timeKnown": False, "birthTime": "junk"})
    assert no_time is not None and no_time.birth_time is None
    _, tz_only = validate_chart_request({**CHART_BODY, "place": {"tz": "UTC"}})
    assert tz_only is not None and tz_only.latitude is None

    bad_bodies = [
        None,
        {**CHART_BODY, "birthDate": "1994-02-30"},
        {**CHART_BODY, "birthDate": "1850-01-01"},
        {**CHART_BODY, "birthDate": "2051-01-01"},
        {**CHART_BODY, "timeKnown": "yes"},
        {**CHART_BODY, "birthTime": "25:00"},
        {**CHART_BODY, "birthTime": None},
        {**CHART_BODY, "place": None},
        {**CHART_BODY, "place": {**NEW_YORK, "tz": "Mars/Olympus"}},
        {**CHART_BODY, "place": {"tz": "UTC", "lat": 10}},
        {**CHART_BODY, "place": {**NEW_YORK, "lat": 91}},
        {**CHART_BODY, "place": {**NEW_YORK, "lon": -181}},
        {**CHART_BODY, "place": {**NEW_YORK, "lat": "40"}},
        {**CHART_BODY, "place": {**NEW_YORK, "lat": True}},
    ]
    for body in bad_bodies:
        errors, parsed = validate_chart_request(body)
        assert errors and parsed is None, body


def test_place_search_ranks_name_matches_by_population():
    first = search_places("new york")[0]
    assert first == {
        "label": "New York City, New York, United States",
        "name": "New York City",
        "region": "New York",
        "country": "United States",
        "lat": 40.7143,
        "lon": -74.006,
        "tz": "America/New_York",
    }
    assert search_places("paris")[0]["country"] == "France"
    assert search_places("LONDON")[0]["tz"] == "Europe/London"


def test_place_search_ignores_accents_and_matches_region_or_country_words():
    assert search_places("sao paulo")[0]["name"] == "São Paulo"
    assert search_places("São Paulo")[0]["name"] == "São Paulo"
    assert search_places("springfield ill")[0]["region"] == "Illinois"
    assert search_places("paris, texas")[0]["label"] == "Paris, Texas, United States"
    assert normalize("  Île-de-France ") == "ile de france"


def test_place_search_bounds():
    assert search_places("") == []
    assert search_places("x") == []
    assert search_places("zzzzqqqq") == []
    assert len(search_places("san")) == 8
    assert len(search_places("san", limit=3)) == 3
    assert search_places("a" * 5000) == []


async def test_chart_endpoint_returns_the_big_three():
    async with api_client(make_deps(env={})) as client:
        response = await client.post("/api/chart", json=CHART_BODY)
        assert response.status_code == 200
        assert response.json() == {
            "sun": "Libra",
            "moon": "Aries",
            "rising": "Scorpio",
            "sunUncertain": False,
            "moonUncertain": False,
        }

        unknown_time = await client.post(
            "/api/chart", json={**CHART_BODY, "timeKnown": False, "birthTime": ""}
        )
        assert unknown_time.json() == {
            "sun": "Libra",
            "moon": "Aries",
            "sunUncertain": False,
            "moonUncertain": True,
        }


async def test_chart_endpoint_rejects_bad_requests():
    async with api_client(make_deps()) as client:
        invalid = await client.post("/api/chart", json={**CHART_BODY, "birthDate": "x"})
        assert invalid.status_code == 400
        assert "birthDate" in invalid.json()["error"]
        assert (await client.post("/api/chart", content=b"{not json")).status_code == 400
        assert (await client.post("/api/chart", json=[1])).status_code == 400
        forbidden = await client.post("/api/chart", json=CHART_BODY, headers={"Host": "evil.test"})
        assert forbidden.status_code == 403


async def test_chart_endpoint_reports_a_missing_ephemeris():
    calculator = ChartCalculator(Path("/nonexistent/de421.bsp"))
    async with api_client(make_deps(), chart=calculator) as client:
        response = await client.post("/api/chart", json=CHART_BODY)
    assert response.status_code == 503
    assert "ephemeris" in response.json()["error"]


async def test_places_endpoint():
    async with api_client(make_deps(env={})) as client:
        response = await client.get("/api/places", params={"q": "haifa"})
        assert response.status_code == 200
        assert response.json()["results"][0]["label"] == "Haifa, Israel"
        assert (await client.get("/api/places")).json() == {"results": []}
        forbidden = await client.get("/api/places?q=haifa", headers={"Host": "evil.test"})
        assert forbidden.status_code == 403
