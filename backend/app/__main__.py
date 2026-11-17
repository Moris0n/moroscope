"""Run the API: `uv run python -m app` (add `--reload` for development)."""

import os
import sys

import uvicorn
from dotenv import load_dotenv

from .config import server_port
from .main import REPO_ROOT

if __name__ == "__main__":
    load_dotenv(REPO_ROOT / ".env")
    uvicorn.run(
        "app.main:create_default_app",
        factory=True,
        host=os.environ.get("HOST") or "127.0.0.1",
        port=server_port(os.environ),
        reload="--reload" in sys.argv,
    )
