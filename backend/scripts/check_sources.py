"""Read every curated source for one sign and month and print what was found.

Talks to the live sites (no LLM, no search, no cost). Use it when a source stops working:
    uv run python scripts/check_sources.py --sign scorpio --month "November 2026"
    uv run python scripts/check_sources.py --url https://example.com/monthly-horoscope
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import tempfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import PipelineDeps
from app.sources import (
    SourcesConfig,
    gather_documents,
    select_sources,
    validate_sources_config,
)
from app.validation import MONTH_NAMES, ZODIAC_SIGNS, parse_month_range
from app.webpages import Target


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sign", default="scorpio")
    parser.add_argument("--month", required=True, help='e.g. "November 2026"')
    parser.add_argument("--url", action="append", default=[], help="check a user source instead")
    parser.add_argument("--show", action="store_true", help="print the start of each document")
    args = parser.parse_args()

    month = parse_month_range(args.month)
    sign = args.sign.capitalize()
    if month is None or sign not in ZODIAC_SIGNS:
        parser.error('use a zodiac sign and a month such as "November 2026"')
    target = Target(sign, MONTH_NAMES[month.month - 1], month.year)

    config = SourcesConfig()
    if args.url:
        errors, parsed = validate_sources_config({"user": [{"url": url} for url in args.url]})
        if errors or parsed is None:
            parser.error("; ".join(errors))
        config = parsed
    _, sources = select_sources(config)

    with tempfile.TemporaryDirectory() as cache_dir:  # never reuse or leave a cache
        async with httpx.AsyncClient(timeout=30.0) as http:
            deps = PipelineDeps(
                env={}, http=http, data_dir=Path(cache_dir), allowed_hosts=frozenset()
            )
            gathered = await gather_documents(deps, sources, target)

    print(f"{target.sign}, {target.label}")
    for entry in gathered.report:
        print(f"  {entry['status']:<12} {entry['name']}  {entry.get('reason', '')}")
    for source in sources:
        if source.domain:
            print(f"  {'search only':<12} {source.name}  (a bare site is searched with Tavily)")
    for doc in gathered.documents:
        print(f"    {len(doc['content']):>6} chars  {doc['source']}: {doc['title'][:70]}")
        print(f"                  {doc['url']}")
        if args.show:
            print(f"                  {doc['content'][:300]!r}")
    return 0 if all(entry["status"] == "used" for entry in gathered.report) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
