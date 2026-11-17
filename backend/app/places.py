"""Offline birth-place search over the bundled GeoNames city list (resources/cities.tsv)."""

from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

CITIES_PATH = Path(__file__).resolve().parent / "resources" / "cities.tsv"
MAX_PLACE_QUERY_LENGTH = 100
MAX_PLACE_RESULTS = 8
_SEPARATORS_RE = re.compile(r"[\W_]+")


@dataclass(frozen=True, slots=True)
class City:
    name: str
    region: str
    country: str
    lat: float
    lon: float
    tz: str
    name_keys: tuple[str, ...]
    words: frozenset[str]

    def as_result(self) -> dict[str, Any]:
        parts = dict.fromkeys(part for part in (self.name, self.region, self.country) if part)
        return {
            "label": ", ".join(parts),
            "name": self.name,
            "region": self.region,
            "country": self.country,
            "lat": self.lat,
            "lon": self.lon,
            "tz": self.tz,
        }


def normalize(text: str) -> str:
    """Lower-case, accent-free, punctuation-free form used for matching."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _SEPARATORS_RE.sub(" ", stripped.casefold()).strip()


@lru_cache(maxsize=1)
def load_cities() -> tuple[City, ...]:
    """Cities ordered by population, largest first."""
    cities = []
    with CITIES_PATH.open(encoding="utf-8", newline="") as handle:
        for name, ascii_name, region, country, lat, lon, tz in csv.reader(
            handle, delimiter="\t", quoting=csv.QUOTE_NONE
        ):
            keys = tuple(dict.fromkeys(normalize(n) for n in (name, ascii_name) if n))
            words = frozenset(" ".join((*keys, normalize(region), normalize(country))).split())
            cities.append(City(name, region, country, float(lat), float(lon), tz, keys, words))
    return tuple(cities)


def search_places(query: str, limit: int = MAX_PLACE_RESULTS) -> list[dict[str, Any]]:
    """Cities whose name starts with the query first, then cities matching every query word."""
    wanted = normalize(query[:MAX_PLACE_QUERY_LENGTH])
    if len(wanted) < 2:
        return []
    tokens = wanted.split()
    by_name: list[City] = []
    by_words: list[City] = []
    for city in load_cities():
        if any(key.startswith(wanted) for key in city.name_keys):
            by_name.append(city)
            if len(by_name) >= limit:
                break
        elif len(by_words) < limit and all(
            any(word.startswith(token) for word in city.words) for token in tokens
        ):
            by_words.append(city)
    return [city.as_result() for city in (by_name + by_words)[:limit]]
