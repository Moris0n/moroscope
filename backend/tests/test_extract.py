import pytest

from app.extract import days_named, quote_in_document, squash, verify_answer
from app.models import ExtractedEvent
from app.validation import parse_month_range

from .helpers import extracted_event

NOVEMBER = parse_month_range("November 2026")
PAGE = (
    "Scorpio Monthly Horoscope November 2026\n"
    "Turn a fresh page at the Scorpio new moon on November 9\n"
    "Fixture new moon paragraph. “Retrograde relief!” Mercury and Venus turn direct "
    "November 13.\nThe Sun is in your sign until the 22nd. From November 3 to 13 take it slow.\n"
    "All month long Jupiter is on your side."
)
TRANSCRIPT = (
    "my dear scorpios on the 13th of november mercury and venus turn direct and then around "
    "the twenty second the sun moves on and on november nine there is a new moon in your sign "
    "from the 9th until the 20th you get one of those windows"
)


def doc(content=PAGE, url="https://astro.example/nov-2026"):
    return {"url": url, "source": "astro.example", "title": "t", "content": content}


def verify(*events, document=None, month=NOVEMBER):
    return verify_answer(list(events), document or doc(), month)


def test_a_quote_is_found_whatever_its_case_punctuation_and_spacing():
    assert squash("  “Retrograde relief!”\nMercury ") == "retrograderelieffmercury".replace(
        "ff", "f"
    )
    assert quote_in_document("new moon on November 9", PAGE)
    assert quote_in_document("NEW MOON on  november 9", PAGE)
    assert quote_in_document('"Retrograde relief!" Mercury and Venus turn direct November 13', PAGE)
    # Across a heading and its paragraph, and in a transcript without any punctuation.
    assert quote_in_document("new moon on November 9. Fixture new moon paragraph", PAGE)
    assert quote_in_document("On the 13th of November, Mercury and Venus turn direct.", TRANSCRIPT)
    # Shortened with an ellipsis: the parts must be there, in that order.
    assert quote_in_document("Scorpio new moon ... Mercury and Venus turn direct", PAGE)
    assert not quote_in_document("Mercury and Venus turn direct … Scorpio new moon", PAGE)

    assert not quote_in_document("full moon on November 9", PAGE)
    assert not quote_in_document("Mercury and Venus turn direct November 14", PAGE)
    assert not quote_in_document("new moon", PAGE), "too short to prove anything"
    assert not quote_in_document("... !!! ...", PAGE)


@pytest.mark.parametrize(
    ("text", "days"),
    [
        ("the new moon on November 9", {9}),
        ("On November 9th, the New Moon", {9}),
        ("Nov 12-14", {12, 14}),
        ("from the 9th until the 20th", {9, 20}),
        ("the 13th of november", {13}),
        ("around the twenty second", {22}),
        ("the twenty-first and the thirty first", {21, 31}),
        ("the thirteenth, the third and the thirtieth", {13, 3, 30}),
        ("on november nine", {9}),
        ("november twenty two", {22}),
        ("twelve november", {12}),
        ("one of those two windows in 2026", set()),
        ("twenty people, 40 days, day 0", set()),
        ("New Moon at 2:02 AM", {2}),  # a time reads like a day: the check is lenient here
    ],
)
def test_the_days_a_text_names_in_digits_or_spelled_out(text, days):
    assert days_named(text) == days


def test_an_event_is_kept_only_with_a_quote_from_the_document_that_names_its_day():
    good = extracted_event(date="2026-11-09", quote="Scorpio new moon on November 9")
    events, dropped = verify(
        good,
        extracted_event(date="2026-11-09", quote="Scorpio full moon on November 9"),
        extracted_event(date="2026-11-10", quote="Scorpio new moon on November 9"),
        extracted_event(date="2026-11-22", quote="Fixture new moon paragraph."),
        extracted_event(date="2026-11-09", quote="moon on"),
        good,
        extracted_event(date="2026-11-31", quote="Scorpio new moon on November 9"),
        extracted_event(lifeAreas=["lottery"], quote="Scorpio new moon on November 9"),
        extracted_event(title=" ", date="2026-11-09", quote="Scorpio new moon on November 9"),
        "not an object",
    )
    assert [(e.date, e.end_date, e.type, e.url) for e in events] == [
        ("2026-11-09", None, "goodTime", "https://astro.example/nov-2026")
    ]
    assert dropped == [
        "the quote is not in the source text",
        "the quote does not name the day",
        "the quote does not name the day",
        "the quote is not in the source text",
        "the event was returned twice",
        "the event has an invalid shape",
        "the event has an invalid shape",
        "the event has an invalid shape",
        "the event has an invalid shape",
    ]


def test_spans_are_cut_to_the_month_and_need_the_first_or_the_last_day_in_the_quote():
    span = "From November 3 to 13 take it slow"
    until = "The Sun is in your sign until the 22nd"
    events, dropped = verify(
        extracted_event(date="2026-11-03", endDate="2026-11-13", quote=span, tone="caution"),
        extracted_event(date="2026-11-01", endDate="2026-11-22", quote=until, tone="neutral"),
        extracted_event(date="2026-10-23", endDate="2026-11-22", quote=until),
        extracted_event(date="2026-11-13", endDate="2026-12-05", quote=span),
        extracted_event(date="2026-11-13", endDate="2026-11-13", quote="turn direct November 13"),
        # Nothing to name for a whole month, but the quote must still be there.
        extracted_event(
            date="2026-11-01", endDate="2026-11-30", quote="All month long Jupiter is on your side"
        ),
        extracted_event(date="2026-10-01", endDate="2026-12-31", quote="All month long Jupiter"),
        extracted_event(date="2026-11-01", endDate="2026-11-30", quote="All year long Jupiter"),
        extracted_event(date="2026-11-13", endDate="2026-11-03", quote=span),
        extracted_event(date="2026-11-04", endDate="2026-11-12", quote=span),
        extracted_event(date="2026-12-03", endDate="2026-12-13", quote=span),
        extracted_event(date="2026-10-03", endDate="2026-10-13", quote=span),
    )
    assert [(e.date, e.end_date, e.type) for e in events] == [
        ("2026-11-03", "2026-11-13", "caution"),
        ("2026-11-01", "2026-11-22", "keyDate"),
        ("2026-11-13", "2026-11-30", "goodTime"),
        ("2026-11-13", None, "goodTime"),
        ("2026-11-01", "2026-11-30", "goodTime"),
        ("2026-11-01", "2026-11-30", "goodTime"),
    ]
    assert dropped == [
        "the event was returned twice",  # from October 23: the same event once cut to the month
        "the quote is not in the source text",
        "the end date is before the start date",
        "the quote does not name the day",
        "the dates are outside the month",
        "the dates are outside the month",
    ]


def test_a_window_of_up_to_three_days_may_be_quoted_by_any_of_its_days():
    text = (
        "venus sextiles jupiter 28th of november active day before day after really lovely "
        "then the 30th of november the sun will trine saturn active the day before the day after"
    )
    venus = "Venus sextiles Jupiter 28th of November active day before day after"
    saturn = "30th of November, the sun will trine Saturn"
    events, dropped = verify(
        extracted_event(date="2026-11-27", endDate="2026-11-29", quote=venus),
        extracted_event(date="2026-11-29", endDate="2026-12-01", quote=saturn),
        extracted_event(date="2026-11-28", endDate="2026-11-29", quote=venus),
        # Four days are a span like any other: its first or its last day.
        extracted_event(date="2026-11-26", endDate="2026-11-29", quote=venus),
        extracted_event(date="2026-11-24", endDate="2026-11-26", quote=venus),
        document=doc(text),
    )
    assert [(e.date, e.end_date) for e in events] == [
        ("2026-11-27", "2026-11-29"),
        ("2026-11-29", "2026-11-30"),
        ("2026-11-28", "2026-11-29"),
    ]
    assert dropped == ["the quote does not name the day"] * 2


def test_transcript_quotes_are_checked_like_any_other():
    events, dropped = verify(
        extracted_event(
            date="2026-11-13", quote="On the 13th of November Mercury and Venus turn direct"
        ),
        extracted_event(date="2026-11-22", quote="around the twenty second the sun moves on"),
        extracted_event(date="2026-11-09", quote="on november nine there is a new moon"),
        extracted_event(
            date="2026-11-09", endDate="2026-11-20", quote="from the 9th until the 20th"
        ),
        extracted_event(date="2026-11-01", quote="you get one of those windows"),
        document=doc(TRANSCRIPT, "https://www.youtube.com/watch?v=x&t=180s"),
    )
    assert [e.date for e in events] == ["2026-11-13", "2026-11-22", "2026-11-09", "2026-11-09"]
    assert dropped == ["the quote does not name the day"]


def test_ids_come_from_the_source_the_dates_and_the_quote_not_from_the_wording():
    quote = "Scorpio new moon on November 9"
    base = extracted_event(date="2026-11-09", quote=quote)

    def event_id(event=base, document=None, month=NOVEMBER):
        [verified], _ = verify(event, document=document, month=month)
        return verified.id

    first = event_id()
    reworded = {
        **base,
        "title": "Other",
        "advice": "Other",
        "tone": "caution",
        "lifeAreas": ["love"],
    }
    assert event_id(reworded) == first
    assert event_id({**base, "quote": "scorpio  NEW MOON on november 9!"}) == first
    assert event_id({**base, "quote": "the Scorpio new moon on November 9"}) != first
    assert event_id({**base, "endDate": "2026-11-12"}) != first
    assert event_id(document=doc(url="https://other.example/nov")) != first
    december = doc(PAGE.replace("November", "December"))
    in_december = {**base, "date": "2026-12-09", "quote": quote.replace("November", "December")}
    assert event_id(in_december, december, parse_month_range("December 2026")) != first


def test_optional_details_outside_the_known_values_are_left_out_not_fatal():
    event = ExtractedEvent.model_validate(
        extracted_event(
            planets=["mercury", "Venus", "Vulcan", "Mercury", 7],
            aspect="wobble",
            house=13,
            inSign="Ophiuchus",
            lifeAreas=["career", "lottery", "career", "love"],
        )
    )
    assert event.planets == ["Mercury", "Venus"]
    assert (event.aspect, event.house, event.in_sign) == (None, None, None)
    assert event.life_areas == ["career", "love"]

    kept = ExtractedEvent.model_validate(
        extracted_event(planets=[], aspect="newMoon", house=8, inSign="Scorpio")
    )
    assert (kept.planets, kept.aspect, kept.house, kept.in_sign) == (None, "newMoon", 8, "Scorpio")
    assert ExtractedEvent.model_validate(extracted_event(house="8")).house is None
