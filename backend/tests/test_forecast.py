from app.extract import verify_answer
from app.forecast import assemble_forecast, rank_events, synthesizer_payload
from app.models import LifeContext
from app.priorities import build_priorities
from app.validation import parse_month_range

from .helpers import extracted_event

NOVEMBER = parse_month_range("November 2026")
MONTH = {"firstDate": "2026-11-01", "lastDate": "2026-11-30", "label": "November 2026"}
TEXT = (
    "New moon in Scorpio on November 9, felt the day before and 3 days after. Mercury turns direct on November 13. "
    "Be careful with money on November 13. Full moon in Gemini on November 24. "
    "Venus enters Libra on November 3, in your twelfth house."
)
A, B = "https://a.example/nov", "https://b.example/nov"


def events_of(url, *events):
    document = {"url": url, "source": url.split("/")[2], "title": "t", "content": TEXT}
    verified, dropped = verify_answer(list(events), document, NOVEMBER)
    assert dropped == []
    return verified


def new_moon(**fields):
    return {
        **extracted_event(
            date="2026-11-09",
            title="New moon in Scorpio",
            advice="A fresh start.",
            tone="neutral",
            lifeAreas=["health"],
            quote="New moon in Scorpio on November 9, felt the day before and 3 days after",
            planets=["Moon"],
            aspect="newMoon",
            inSign="Scorpio",
        ),
        **fields,
    }


def direct(**fields):
    return {
        **extracted_event(
            date="2026-11-13",
            title="Mercury turns direct",
            advice="Sign and send.",
            lifeAreas=["communication"],
            quote="Mercury turns direct on November 13",
            planets=["Mercury"],
            aspect="direct",
        ),
        **fields,
    }


def careful():
    return extracted_event(
        date="2026-11-13",
        title="Watch your spending",
        advice="Hold off on purchases.",
        tone="caution",
        lifeAreas=["money"],
        quote="Be careful with money on November 13",
    )


def full_moon():
    return extracted_event(
        date="2026-11-24",
        title="Full moon in Gemini",
        advice="Something completes.",
        tone="neutral",
        lifeAreas=["rest"],
        quote="Full moon in Gemini on November 24",
        inSign="Gemini",
    )


def ranked(focus=("career",), sign="Scorpio", **life_context):
    verified = [
        *events_of(A, new_moon(), direct(), careful(), full_moon()),
        *events_of(B, new_moon(lifeAreas=["love"]), direct(tone="caution")),
    ]
    priorities = build_priorities(list(focus), LifeContext.model_validate(life_context).answers())
    return rank_events(verified, priorities, sign), priorities


def group(events, *titles, **fields):
    ids = [e.id for title in titles for e in events if e.verified.event.title == title]
    return {"eventIds": ids, "title": "Synthesized", "summary": "What the sources say.", **fields}


def assemble(answer, events, **kwargs):
    errors, forecast = assemble_forecast(answer, events, **kwargs)
    assert errors == []
    return forecast.to_json()


def test_ranking_orders_by_priority_then_date_and_never_filters():
    events, _ = ranked(["money", "communication"], kids=["under5"])
    # Money (also through the 8th house of the Gemini full moon), then communication, then the
    # rest by date. The family priority (houses 5 and 4) matches nothing here.
    assert [(e.verified.event.title, e.verified.source, e.rank) for e in events] == [
        ("Watch your spending", "a.example", 0),
        ("Full moon in Gemini", "a.example", 0),
        ("Mercury turns direct", "a.example", 1),
        ("Mercury turns direct", "b.example", 1),
        ("New moon in Scorpio", "a.example", None),
        ("New moon in Scorpio", "b.example", None),
    ]
    assert len(events) == 6

    unranked, _ = ranked([])
    assert all(e.rank is None for e in unranked)
    assert [e.verified.date for e in unranked] == sorted(e.verified.date for e in unranked)


def test_a_missing_house_is_computed_from_the_reading_sign_and_only_then_adds_its_life_areas():
    by_title = {e.verified.event.title: e for e in ranked()[0] if e.verified.source == "a.example"}
    assert by_title["New moon in Scorpio"].house == 1
    assert by_title["New moon in Scorpio"].life_areas == ("health",)
    assert by_title["Full moon in Gemini"].house == 8
    assert by_title["Full moon in Gemini"].life_areas == ("rest", "money")
    assert by_title["Mercury turns direct"].house is None

    for_leo = {e.verified.event.title: e for e in ranked(sign="Leo")[0]}
    assert for_leo["Full moon in Gemini"].house == 11
    assert for_leo["Full moon in Gemini"].life_areas == ("rest", "community")

    # A house the source states wins over the one its sign would give, and adds no life area: the
    # Extractor read what the source connects that house to.
    stated = extracted_event(
        date="2026-11-03",
        quote="Venus enters Libra on November 3, in your twelfth house",
        house=11,
        inSign="Libra",
        lifeAreas=["love"],
    )
    [event] = rank_events(events_of(A, stated), build_priorities([], {}), "Scorpio")
    assert (event.house, event.life_areas) == (11, ("love",))
    # It still counts for the ranking: a priority covers its houses.
    [event] = rank_events(events_of(A, stated), build_priorities(["community"], {}), "Scorpio")
    assert event.rank == 0


def test_the_synthesizer_payload_lists_the_events_without_quotes_or_urls():
    events, priorities = ranked(["money"], work="jobSeeking", goals="Find a role")
    upcoming = [{"date": "2026-11-16", "label": "Final interview"}]
    payload = synthesizer_payload(MONTH, "Scorpio", priorities, upcoming, events, " pasted ")
    assert payload["priorities"] == (
        "First priority: Money & Resources. Second: Career & Work (looking for a job). "
        'Stated goal, in the user\'s words: "Find a role".'
    )
    assert payload["upcomingEvents"] == upcoming and payload["customExcerpt"] == " pasted "
    assert payload["events"][0] == {
        "id": events[0].id,
        "date": "2026-11-13",
        "type": "caution",
        "lifeAreas": ["money"],
        "title": "Watch your spending",
        "advice": "Hold off on purchases.",
        "source": "a.example",
        "inFocus": True,
        "priority": 1,
    }
    moon = next(e for e in payload["events"] if e["title"] == "New moon in Scorpio")
    assert moon["inFocus"] is False and "priority" not in moon
    assert (moon["planets"], moon["aspect"], moon["house"]) == (["Moon"], "newMoon", 1)
    assert "house" not in payload["events"][-1] and "endDate" not in payload["events"][-1]
    sent = str(payload)
    assert "https://" not in sent and "on November" not in sent

    bare = synthesizer_payload(MONTH, "Scorpio", build_priorities([], {}), [], events, "  ")
    assert set(bare) == {"month", "sign", "priorities", "events"}


def test_events_from_several_sources_merge_where_their_dates_are_the_same():
    events, _ = ranked(["communication"])
    answer = {
        "theme": "  A month of turning points.  ",
        "groups": [
            group(events, "New moon in Scorpio", title="Scorpio new moon", personalNote="Note."),
            group(events, "Mercury turns direct", title="Mercury direct"),
            group(events, "Full moon in Gemini", "Watch your spending", title="Mixed dates"),
        ],
    }
    out = assemble(answer, events)
    assert out["theme"] == "A month of turning points."
    assert [(e["date"], e["title"]) for e in out["events"]] == [
        ("2026-11-09", "Scorpio new moon"),
        ("2026-11-13", "Mercury direct"),
        # A group across two dates: its first event keeps the wording, the other its own.
        ("2026-11-13", "Mixed dates"),
        ("2026-11-24", "Full moon in Gemini"),
    ]
    moon, mercury, spending, full = out["events"]
    assert moon == {
        "id": next(e.id for e in events if e.verified.event.title == "New moon in Scorpio"),
        "date": "2026-11-09",
        "title": "Scorpio new moon",
        "type": "keyDate",
        "lifeAreas": ["health", "love"],
        "summary": "What the sources say.",
        "sourceUrls": [A, B],
        "inFocus": False,
        "planets": ["Moon"],
        "aspect": "newMoon",
        "house": 1,
    }, "no personal note without a life context"
    # One source calls it favourable, the other advises care: a key date, citing both.
    assert (mercury["type"], mercury["sourceUrls"], mercury["inFocus"]) == ("keyDate", [A, B], True)
    assert (spending["summary"], spending["type"]) == ("What the sources say.", "caution")
    assert spending["sourceUrls"] == [A]
    assert (full["summary"], full["sourceUrls"]) == ("Something completes.", [A])
    assert out["icsContent"].count("BEGIN:VEVENT") == 4

    noted = assemble(answer, events, personal_notes=True)
    assert [e.get("personalNote") for e in noted["events"]] == ["Note.", None, None, None]


def test_of_a_group_with_differing_dates_the_largest_part_with_the_same_dates_is_merged():
    document_c = "https://c.example/nov"
    spans = [
        *events_of(A, new_moon()),
        # Reported as a period (no aspect), so its end date stands.
        *events_of(B, new_moon(endDate="2026-11-12", aspect=None)),
        *events_of(document_c, new_moon(), full_moon()),
    ]
    events = rank_events(spans, build_priorities([], {}), "Scorpio")
    ids = [e.id for e in events]
    answer = {"theme": "t", "groups": [{"eventIds": ids, "title": "Merged", "summary": "s"}]}
    shown = {
        (e["date"], e.get("endDate"), e["title"], tuple(sorted(e["sourceUrls"])))
        for e in assemble(answer, events)["events"]
    }
    assert shown == {
        ("2026-11-09", None, "Merged", (A, document_c)),
        ("2026-11-09", "2026-11-12", "New moon in Scorpio", (B,)),
        ("2026-11-24", None, "Full moon in Gemini", (document_c,)),
    }
    # The events left out of a group can still be worded by a later one: again the largest part,
    # here the earlier of the two that are left.
    answer["groups"].append({"eventIds": ids, "title": "Second", "summary": "s"})
    again = assemble(answer, events)["events"]
    assert sorted(e["title"] for e in again) == ["Full moon in Gemini", "Merged", "Second"]
    assert next(e for e in again if e["title"] == "Second")["endDate"] == "2026-11-12"


def test_a_merged_event_keeps_the_window_each_source_gives():
    document_c = "https://c.example/nov"
    events = rank_events(
        [
            *events_of(A, new_moon()),
            *events_of(B, new_moon(activeFrom="2026-11-06", activeUntil="2026-11-12")),
            # An end date on a sky event whose quote names only its day: a window, so it merges.
            *events_of(document_c, new_moon(endDate="2026-11-10")),
        ],
        build_priorities([], {}),
        "Scorpio",
    )
    payload = synthesizer_payload(MONTH, "Scorpio", build_priorities([], {}), [], events)
    assert sorted(
        (e["source"], e.get("endDate"), e.get("activeFrom"), e.get("activeUntil"))
        for e in payload["events"]
    ) == [
        ("a.example", None, None, None),
        ("b.example", None, "2026-11-06", "2026-11-12"),
        ("c.example", None, None, "2026-11-10"),
    ]
    answer = {
        "theme": "t",
        "groups": [{"eventIds": [e.id for e in events], "title": "Merged", "summary": "s"}],
    }
    [event] = assemble(answer, events)["events"]
    assert (event["date"], event.get("endDate")) == ("2026-11-09", None)
    assert sorted(event["sourceUrls"]) == [A, B, document_c]
    assert sorted(event["activeWindows"], key=lambda w: w["sourceUrl"]) == [
        {"sourceUrl": B, "start": "2026-11-06", "end": "2026-11-12"},
        {"sourceUrl": document_c, "end": "2026-11-10"},
    ]
    # Without a window, the field is absent.
    [plain] = assemble(
        {"theme": "t", "groups": []},
        events[:0] + rank_events(events_of(A, new_moon()), build_priorities([], {}), "Scorpio"),
    )["events"]
    assert "activeWindows" not in plain


def test_ids_that_do_not_exist_or_are_used_twice_are_skipped_and_nothing_is_lost():
    events, _ = ranked([])
    spending = next(e for e in events if e.verified.event.title == "Watch your spending")
    answer = {
        "theme": "t",
        "groups": [
            {"eventIds": [spending.id, "feedfacecafe"], "title": "First use", "summary": "s"},
            {"eventIds": [spending.id], "title": "Second use", "summary": "s"},
            {"eventIds": ["feedfacecafe"], "title": "Made up", "summary": "s"},
            {"eventIds": [], "title": "Empty", "summary": "s"},
            {"eventIds": [events[0].id], "title": " ", "summary": "s"},
            {"eventIds": [events[0].id], "title": "No summary"},
            "not an object",
        ],
    }
    out = assemble(answer, events)
    titles = [e["title"] for e in out["events"]]
    assert len(out["events"]) == 6, "every verified event is shown, merged or not"
    assert titles.count("First use") == 1
    assert not {"Second use", "Made up", "Empty", "No summary"} & set(titles)
    assert sorted(e["id"] for e in out["events"]) == sorted(e.id for e in events)
    assert [e["date"] for e in out["events"]] == sorted(e["date"] for e in out["events"])

    # Without any group at all, the forecast is the extracted events as they are.
    plain = assemble({"theme": "t", "groups": []}, events)
    assert sorted(e["title"] for e in plain["events"]) == sorted(
        e.verified.event.title for e in events
    )

    for bad in ("text", [], {"groups": []}, {"theme": "", "groups": []}, {"theme": "t"}):
        errors, forecast = assemble_forecast(bad, events)
        assert errors and forecast is None
    # An error names the field, never what the model wrote.
    errors, _ = assemble_forecast({"theme": "t", "groups": "secret words"}, events)
    assert errors == ["groups: Input should be a valid list"]


def test_ids_stay_the_same_whatever_the_synthesizer_writes_or_merges():
    events, _ = ranked([])
    merged = assemble(
        {"theme": "t", "groups": [group(events, "New moon in Scorpio", title="Merged")]}, events
    )
    separate = assemble({"theme": "other words", "groups": []}, events)
    merged_ids = {e["id"] for e in merged["events"]}
    assert len(merged_ids) == 5 and len(separate["events"]) == 6
    assert merged_ids < {e["id"] for e in separate["events"]}
    # The merged event carries the id of its first member.
    first = next(e for e in events if e.verified.event.title == "New moon in Scorpio")
    assert next(e for e in merged["events"] if e["title"] == "Merged")["id"] == first.id
