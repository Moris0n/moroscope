"""Download the JPL DE421 ephemeris (about 17 MB) that /api/chart needs.

Usage: uv run python scripts/fetch_ephemeris.py
The file is verified against a pinned SHA-256 and is not committed to git.
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import httpx

URL = "https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de421.bsp"
TARGET = Path(__file__).resolve().parents[1] / "app" / "resources" / "de421.bsp"
SHA256 = "a20a7139da04cbc462454634918e9a9ca69127044e2cc9d4f9c16e238d2deedc"


def main() -> int:
    target = TARGET
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == SHA256:
        print(f"{target} is already present.")
        return 0
    print(f"Downloading {URL} ...")
    digest = hashlib.sha256()
    tmp = target.with_suffix(".tmp")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with httpx.stream("GET", URL, follow_redirects=True, timeout=60.0) as response:
            response.raise_for_status()
            with tmp.open("wb") as handle:
                for chunk in response.iter_bytes():
                    digest.update(chunk)
                    handle.write(chunk)
        if digest.hexdigest() != SHA256:
            print("Checksum mismatch; the download was discarded.", file=sys.stderr)
            return 1
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)
    print(f"Saved {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
