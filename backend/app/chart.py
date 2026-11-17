"""Natal "Big Three" (Sun, Moon and Rising sign) from a real ephemeris: Skyfield + JPL DE421."""

from __future__ import annotations

import math
import threading
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from skyfield.api import load, load_file
from skyfield.errors import EphemerisRangeError
from skyfield.framelib import ecliptic_frame
from skyfield.nutationlib import mean_obliquity

from .config import PipelineError
from .validation import ZODIAC_ORDER, ChartRequest

DEFAULT_EPHEMERIS_PATH = Path(__file__).resolve().parent / "resources" / "de421.bsp"


def sign_of(longitude_degrees: float) -> str:
    """Tropical zodiac sign for an ecliptic longitude."""
    return ZODIAC_ORDER[int(longitude_degrees % 360 // 30)]


def ascendant_longitude(
    sidereal_degrees: float, obliquity_degrees: float, latitude: float
) -> float:
    """Ecliptic longitude rising on the eastern horizon, from local sidereal time and latitude."""
    ramc, eps, lat = (math.radians(v) for v in (sidereal_degrees, obliquity_degrees, latitude))
    x = -(math.sin(ramc) * math.cos(eps) + math.tan(lat) * math.sin(eps))
    return math.degrees(math.atan2(math.cos(ramc), x)) % 360


class ChartCalculator:
    """Loads the ephemeris on first use; safe to share between threads."""

    def __init__(self, ephemeris_path: Path = DEFAULT_EPHEMERIS_PATH) -> None:
        self._path = ephemeris_path
        self._lock = threading.Lock()
        self._loaded: tuple[Any, Any] | None = None

    def _load(self) -> tuple[Any, Any]:
        with self._lock:
            if self._loaded is None:
                if not self._path.is_file():
                    raise PipelineError(
                        503,
                        "Chart calculation is not set up: the ephemeris file is missing "
                        "(run `uv run python scripts/fetch_ephemeris.py` in backend/).",
                    )
                self._loaded = (load.timescale(builtin=True), load_file(str(self._path)))
            return self._loaded

    def compute(self, request: ChartRequest) -> dict[str, Any]:
        timescale, ephemeris = self._load()
        zone = ZoneInfo(request.timezone)

        def local(day_offset: int, at: time) -> datetime:
            day = request.birth_date + timedelta(days=day_offset)
            return datetime.combine(day, at, tzinfo=zone).astimezone(UTC)

        if request.birth_time is not None:
            instants = [local(0, request.birth_time)]
        else:
            instants = [local(0, time(12)), local(0, time(0)), local(1, time(0))]
        times = timescale.from_datetimes(instants)

        earth = ephemeris["earth"]
        try:
            signs = {
                body: [
                    sign_of(longitude)
                    for longitude in earth.at(times)
                    .observe(ephemeris[body])
                    .apparent()
                    .frame_latlon(ecliptic_frame)[1]
                    .degrees
                ]
                for body in ("sun", "moon")
            }
        except EphemerisRangeError:
            raise PipelineError(400, "birthDate is outside the supported range.") from None

        chart: dict[str, Any] = {
            "sun": signs["sun"][0],
            "moon": signs["moon"][0],
            "sunUncertain": len(set(signs["sun"])) > 1,
            "moonUncertain": len(set(signs["moon"])) > 1,
        }
        if request.birth_time is not None and request.latitude is not None:
            moment = times[0]
            sidereal = moment.gast * 15 + (request.longitude or 0.0)
            obliquity = mean_obliquity(moment.tdb) / 3600
            chart["rising"] = sign_of(ascendant_longitude(sidereal, obliquity, request.latitude))
        return chart
