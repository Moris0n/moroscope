"""Write the JSON Schema of the API models, from which the frontend types are generated.

    uv run python scripts/export_schema.py            # rewrite schema/api.schema.json
    uv run python scripts/export_schema.py --check    # exit 1 if the file is out of date

`npm run gen:types` (repo root) runs this and then writes src/types/api.generated.ts.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from pydantic.json_schema import models_json_schema

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import SCHEMA_MODELS

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema" / "api.schema.json"


def _without_null(node: Any) -> Any:
    """An optional field is left out on the wire, so `null` is dropped from its schema."""
    if isinstance(node, list):
        return [_without_null(item) for item in node]
    if not isinstance(node, dict):
        return node
    node = {key: _without_null(value) for key, value in node.items()}
    options = node.get("anyOf")
    if isinstance(options, list) and {"type": "null"} in options:
        rest = [option for option in options if option != {"type": "null"}]
        del node["anyOf"]
        if node.get("default", "") is None:
            del node["default"]
        node = {**rest[0], **node} if len(rest) == 1 else {**node, "anyOf": rest}
    return node


def _without_titles(node: Any) -> Any:
    """Property titles would each become a named type, and list bounds a tuple type."""
    if isinstance(node, list):
        return [_without_titles(item) for item in node]
    if not isinstance(node, dict):
        return node
    return {
        key: {name: _without_titles(prop) for name, prop in value.items()}
        if key == "properties"
        else _without_titles(value)
        for key, value in node.items()
        if key not in ("title", "minItems", "maxItems")
    }


def build_schema() -> dict[str, Any]:
    _, schema = models_json_schema(list(SCHEMA_MODELS), ref_template="#/$defs/{model}")
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "MoroscopeApi",
        "description": "Generated from backend/app/models.py. Do not edit.",
        "$defs": {
            name: {"title": name, **_without_titles(_without_null(definition))}
            for name, definition in schema["$defs"].items()
        },
    }


def render() -> str:
    return json.dumps(build_schema(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


if __name__ == "__main__":
    if "--check" in sys.argv:
        current = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.is_file() else ""
        if current != render():
            sys.exit("schema/api.schema.json is out of date: run `npm run gen:types`.")
    else:
        SCHEMA_PATH.write_text(render(), encoding="utf-8")
