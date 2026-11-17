"""Rebuild app/resources/cities.tsv from the GeoNames dumps (CC BY 4.0, https://www.geonames.org).

Usage: uv run python scripts/build_cities.py <dir>
<dir> must hold cities15000.txt, admin1CodesASCII.txt and countryInfo.txt from
https://download.geonames.org/export/dump/.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

OUTPUT = Path(__file__).resolve().parents[1] / "app" / "resources" / "cities.tsv"


def _rows(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
        return [row for row in reader if row and not row[0].startswith("#")]


def main(source: Path) -> None:
    countries = {row[0]: row[4] for row in _rows(source / "countryInfo.txt")}
    regions = {row[0]: row[1] for row in _rows(source / "admin1CodesASCII.txt")}
    cities = []
    for row in _rows(source / "cities15000.txt"):
        name, ascii_name, lat, lon, country_code, admin1 = (
            row[1],
            row[2],
            row[4],
            row[5],
            row[8],
            row[10],
        )
        population, tz = int(row[14] or 0), row[17]
        try:
            ZoneInfo(tz)
        except (KeyError, ValueError):
            continue
        cities.append(
            (
                -population,
                name,
                ascii_name if ascii_name != name else "",
                regions.get(f"{country_code}.{admin1}", ""),
                countries.get(country_code, country_code),
                f"{float(lat):.4f}",
                f"{float(lon):.4f}",
                tz,
            )
        )
    cities.sort()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", quoting=csv.QUOTE_NONE, lineterminator="\n")
        writer.writerows(city[1:] for city in cities)
    print(f"Wrote {len(cities)} cities to {OUTPUT}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
