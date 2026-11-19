"""What the user cares about this month, worked out in code: houses, ranking and the narrative.

The Synthesizer is told about the user through one text built here from a fixed template, so
nothing reaches it that the user did not state.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .models import LIFE_AREA_LABELS, LIFE_AREAS, ZODIAC

# The houses behind each life area (the roadmap's table).
AREA_HOUSES: dict[str, tuple[int, ...]] = {
    "career": (10, 6),
    "money": (2, 8),
    "love": (5, 7),
    "family": (4,),
    "health": (6, 1),
    "community": (11,),
    "communication": (3,),
    "learning": (9,),
    "creativity": (5,),
    "rest": (12, 8),
}
HOUSE_AREAS: dict[int, tuple[str, ...]] = {
    house: tuple(area for area in LIFE_AREAS if house in AREA_HOUSES[area])
    for house in range(1, 13)
}

# Each answer of the life context in words, and the priority it stands for, if any:
# (phrase, life area, houses).
_Answer = tuple[str, str | None, tuple[int, ...]]
_WORK: dict[str, _Answer] = {
    "employed": ("employed", None, ()),
    "jobSeeking": ("looking for a job", "career", (10, 6)),
    "consideringChange": ("considering a job change", "career", (10, 6)),
    "selfEmployed": ("self-employed", None, ()),
    "student": ("a student", "learning", (9,)),
    "parentalLeave": ("on parental leave", "family", (4, 5)),
    "retired": ("retired", None, ()),
}
_RELATIONSHIP: dict[str, _Answer] = {
    "single": ("single", None, ()),
    "dating": ("dating", "love", (5, 7)),
    "inRelationship": ("in a relationship", "love", (7,)),
    "married": ("married", "love", (7,)),
    "separated": ("separated", "love", (7,)),
    "complicated": ("in a complicated relationship", "love", (7,)),
}
_LOOKING_FOR_PARTNER: _Answer = ("looking for a partner", "love", (5, 7))
_KIDS: dict[str, _Answer] = {
    "none": ("no children", None, ()),
    "trying": ("trying for a baby", "family", (5, 4)),
    "expecting": ("expecting a child", "family", (5, 4)),
    "under5": ("a child under 5", "family", (5, 4)),
    "age5to12": ("a child aged 5 to 12", "family", (5, 4)),
    "teens": ("a teenager", "family", (5, 4)),
    "adult": ("a grown-up child", "family", (5, 4)),
}
_CARING_FOR_PARENTS: _Answer = ("caring for parents", "family", (4,))
_MONEY: dict[str, str] = {
    "saving": "saving money",
    "bigPurchase": "planning a big purchase",
    "investing": "investing",
    "debt": "paying off debt",
}
_HEALTH: dict[str, str] = {
    "fitness": "fitness",
    "sleep": "sleep",
    "stress": "stress",
    "nutrition": "nutrition",
    "habit": "a specific habit",
}
_ORDINALS = (
    "First priority",
    "Second",
    "Third",
    "Fourth",
    "Fifth",
    "Sixth",
    "Seventh",
    "Eighth",
    "Ninth",
    "Tenth",
)
NOTHING_STATED = "Nothing was stated: treat all life areas alike."


@dataclass
class Priority:
    area: str
    houses: tuple[int, ...]
    picked: bool  # chosen by hand as a focus area; otherwise derived from the life context
    reasons: list[str]


@dataclass
class Priorities:
    ranked: list[Priority]
    also_stated: list[str]  # answers that stand for no priority
    goals: str = ""

    def rank(self, life_areas: list[str], house: int | None) -> int | None:
        """The place (from 0) of the first priority an event touches, by life area or by house."""
        for index, priority in enumerate(self.ranked):
            if priority.area in life_areas or (house is not None and house in priority.houses):
                return index
        return None

    def narrative(self) -> str:
        """The only description of the user the Synthesizer gets. A strict template."""
        sentences = []
        for ordinal, priority in zip(_ORDINALS, self.ranked):
            reason = f" ({', '.join(priority.reasons)})" if priority.reasons else ""
            sentences.append(f"{ordinal}: {LIFE_AREA_LABELS[priority.area]}{reason}.")
        if self.also_stated:
            sentences.append(f"Also stated: {', '.join(self.also_stated)}.")
        if self.goals:
            # Free text: quoted as data. JSON string escaping keeps it inside its quotes.
            sentences.append(f"Stated goal, in the user's words: {_quoted(self.goals)}.")
        return " ".join(sentences) or NOTHING_STATED


def _quoted(text: str) -> str:
    return '"' + " ".join(text.replace('"', "'").split()) + '"'


def _answers(life_context: dict[str, Any]) -> list[_Answer]:
    """The stated answers in a fixed order: work, relationship, children, parents, money, health."""
    answers: list[_Answer] = []
    if work := _WORK.get(life_context.get("work", "")):
        answers.append(work)
    if relationship := _RELATIONSHIP.get(life_context.get("relationship", "")):
        answers.append(relationship)
    if life_context.get("lookingForPartner") is True:
        answers.append(_LOOKING_FOR_PARTNER)
    answers.extend(_KIDS[stage] for stage in life_context.get("kids") or [] if stage in _KIDS)
    if life_context.get("caringForParents") is True:
        answers.append(_CARING_FOR_PARENTS)
    if money := _MONEY.get(life_context.get("moneyFocus", "")):
        answers.append((money, "money", (2, 8)))
    health = [_HEALTH[item] for item in life_context.get("healthFocus") or [] if item in _HEALTH]
    if health:
        answers.append((f"health focus: {', '.join(health)}", "health", (6, 1)))
    return answers


def build_priorities(focus_areas: list[str], life_context: dict[str, Any]) -> Priorities:
    """Hand-picked focus areas first, in the picked order, then the areas the life context
    points to. `life_context` holds only what was answered (`LifeContext.answers`)."""
    by_area: dict[str, Priority] = {
        area: Priority(area, AREA_HOUSES[area], True, []) for area in focus_areas
    }
    also_stated: list[str] = []
    for phrase, area, houses in _answers(life_context):
        if area is None:
            also_stated.append(phrase)
            continue
        priority = by_area.setdefault(area, Priority(area, (), False, []))
        priority.houses = tuple(dict.fromkeys(priority.houses + houses))
        priority.reasons.append(phrase)
    goals = life_context.get("goals")
    return Priorities(
        list(by_area.values()), also_stated, goals.strip() if isinstance(goals, str) else ""
    )


def house_of(event_sign: str | None, reading_sign: str) -> int | None:
    """The whole-sign house of a zodiac sign, counted from the sign the forecast is read for."""
    if event_sign not in ZODIAC or reading_sign not in ZODIAC:
        return None
    return (ZODIAC.index(event_sign) - ZODIAC.index(reading_sign)) % 12 + 1


def with_house_areas(life_areas: list[str], house: int | None) -> list[str]:
    """The event's life areas followed by those of its house, each once."""
    return list(dict.fromkeys([*life_areas, *HOUSE_AREAS.get(house or 0, ())]))
