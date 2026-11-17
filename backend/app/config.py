"""Environment-driven configuration."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

LOCAL_HOSTNAMES = ("localhost", "127.0.0.1", "[::1]")
DEFAULT_PORT = 8000
DEFAULT_FRONTEND_PORT = 3000


class PipelineError(Exception):
    """An error with the HTTP status the API should answer with."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class AgentConfig:
    nebius_api_key: str
    nebius_base_url: str
    nebius_model: str
    tavily_api_key: str


def load_agent_config(env: Mapping[str, str]) -> AgentConfig:
    names = ("NEBIUS_API_KEY", "NEBIUS_BASE_URL", "NEBIUS_MODEL", "TAVILY_API_KEY")
    values = {name: (env.get(name) or "").strip() for name in names}
    missing = [name for name in names if not values[name]]
    if missing:
        raise PipelineError(
            503, f"Forecast backend is not configured (missing: {', '.join(missing)})."
        )

    base_url = values["NEBIUS_BASE_URL"].rstrip("/")
    try:
        parts = urlsplit(base_url)
        hostname, username, password = parts.hostname, parts.username, parts.password
    except ValueError:
        raise PipelineError(503, "NEBIUS_BASE_URL is not a valid URL.") from None
    if not parts.scheme:
        raise PipelineError(503, "NEBIUS_BASE_URL is not a valid URL.")
    if parts.scheme not in ("http", "https"):
        raise PipelineError(503, "NEBIUS_BASE_URL must be an http(s) URL.")
    if not hostname:
        raise PipelineError(503, "NEBIUS_BASE_URL is not a valid URL.")
    if username or password:
        raise PipelineError(503, "NEBIUS_BASE_URL must not contain credentials.")
    if parts.query or parts.fragment or "?" in base_url or "#" in base_url:
        raise PipelineError(503, "NEBIUS_BASE_URL must not contain a query or fragment.")

    return AgentConfig(
        nebius_api_key=values["NEBIUS_API_KEY"],
        nebius_base_url=base_url,
        nebius_model=values["NEBIUS_MODEL"],
        tavily_api_key=values["TAVILY_API_KEY"],
    )


def _port(env: Mapping[str, str], name: str, default: int) -> int:
    try:
        return int(env.get(name) or default)
    except ValueError:
        return default


def server_port(env: Mapping[str, str]) -> int:
    return _port(env, "PORT", DEFAULT_PORT)


def local_allowed_hosts(*ports: int) -> frozenset[str]:
    """Host header values accepted for a server reachable only from this machine."""
    hosts = set(LOCAL_HOSTNAMES)
    hosts.update(f"{name}:{port}" for name in LOCAL_HOSTNAMES for port in ports)
    return frozenset(hosts)


def load_allowed_hosts(env: Mapping[str, str]) -> frozenset[str]:
    """ALLOWED_HOSTS (comma-separated `host` or `host:port`) overrides the localhost default."""
    configured = [h.strip().lower() for h in (env.get("ALLOWED_HOSTS") or "").split(",")]
    configured = [h for h in configured if h]
    if configured:
        return frozenset(configured)
    return local_allowed_hosts(server_port(env), _port(env, "FRONTEND_PORT", DEFAULT_FRONTEND_PORT))
