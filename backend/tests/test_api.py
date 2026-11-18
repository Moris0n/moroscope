import asyncio
import json
import re
import socket
import stat

import pytest
import uvicorn

from app.main import create_app

from .helpers import (
    CAFE_URL,
    PORT,
    UUID_PATTERN,
    VALID_PROFILE,
    Upstream,
    api_client,
    make_deps,
    parse_sse,
    profile_files,
    source_pages,
    valid_event,
    valid_forecast,
)

SYNTHESIZE = "/api/horoscope/synthesize"
BODY = {"profile": VALID_PROFILE}
SSE = {"Accept": "text/event-stream"}


async def test_post_profiles_saves_atomically_without_agent_keys():
    deps = make_deps(env={})
    async with api_client(deps) as client:
        response = await client.post("/api/profiles", json=BODY)
    assert response.status_code == 200
    profile_id = response.json()["profileId"]
    assert re.match(UUID_PATTERN, profile_id)

    files = profile_files(deps)
    assert [f.name for f in files] == [f"{profile_id}.json"]
    stored = json.loads(files[0].read_text())
    assert stored["name"] == "Test User"
    assert "backendUrl" not in stored
    assert stat.S_IMODE(files[0].stat().st_mode) == 0o600


async def test_post_profiles_reuses_a_given_profile_id():
    deps = make_deps()
    async with api_client(deps) as client:
        first = (await client.post("/api/profiles", json=BODY)).json()["profileId"]
        renamed = {"profile": {**VALID_PROFILE, "name": "Renamed"}, "profileId": first}
        second = await client.post("/api/profiles", json=renamed)
    assert second.json() == {"profileId": first}
    assert len(profile_files(deps)) == 1
    assert json.loads(profile_files(deps)[0].read_text())["name"] == "Renamed"


async def test_post_profiles_rejects_bad_ids_bad_profiles_and_bad_bodies():
    deps = make_deps()
    async with api_client(deps) as client:
        for profile_id in ["../../etc/passwd", "not-a-uuid", "../x.json", 42]:
            bad = await client.post("/api/profiles", json={**BODY, "profileId": profile_id})
            assert bad.status_code == 400, profile_id

        invalid = await client.post("/api/profiles", json={"profile": {"targetMonth": "x"}})
        assert invalid.status_code == 400
        assert "name must be" in invalid.json()["error"]

        assert (await client.post("/api/profiles", content=b"{not json")).status_code == 400
        assert (await client.post("/api/profiles", json=[1, 2])).status_code == 400
        huge = json.dumps({**BODY, "pad": "x" * (2 * 1024 * 1024)})
        assert (await client.post("/api/profiles", content=huge)).status_code == 413
    assert profile_files(deps) == []


async def test_host_allowlist_and_cross_origin_requests_are_rejected():
    async with api_client(make_deps()) as client:

        async def post(**headers):
            return (await client.post("/api/profiles", json=BODY, headers=headers)).status_code

        assert await post(Host="evil.example.com") == 403
        assert await post(Host="localhost:9999") == 403
        assert await post(Host=f"127.0.0.1:{PORT}", Origin="https://evil.example.com") == 403
        assert await post(Host=f"127.0.0.1:{PORT}", Origin="http://localhost:9999") == 403
        assert await post(Host=f"127.0.0.1:{PORT}", Origin="null") == 403
        assert await post(Host=f"127.0.0.1:{PORT}", Origin=f"http://127.0.0.1:{PORT}") == 200
        assert await post(Host=f"localhost:{PORT}") == 200
        assert await post(Host="localhost", Origin="http://localhost:80") == 200


async def test_synthesize_validates_the_request_before_doing_any_work():
    upstream = Upstream()
    deps = make_deps(upstream)
    async with api_client(deps) as client:
        for body in [
            {"profile": {**VALID_PROFILE, "sunSign": "Nope"}},
            {**BODY, "profileId": "nope"},
            {**BODY, "customExcerpt": "x" * 8001},
            {**BODY, "customExcerpt": 5},
            {**BODY, "sources": "all"},
            {**BODY, "sources": {"user": [{"url": "ftp://files.example/x"}]}},
            {**BODY, "sources": {"user": [{"url": "https://user:pw@site.example/x"}]}},
            {**BODY, "sources": {"user": [{"url": f"https://s{i}.example/x"} for i in range(11)]}},
            {**BODY, "sources": {"includeCurated": "yes"}},
            {"profile": {**VALID_PROFILE, "lifeContext": {"work": "astronaut"}}},
        ]:
            assert (await client.post(SYNTHESIZE, json=body)).status_code == 400
    assert upstream.calls == [] and upstream.page_calls == [] and profile_files(deps) == []


async def test_json_response_returns_result_and_profile_id():
    upstream = Upstream(delay=0.01)
    async with api_client(make_deps(upstream)) as client:
        response = await client.post(SYNTHESIZE, json=BODY)
    assert response.status_code == 200
    data = response.json()
    assert re.match(UUID_PATTERN, data["profileId"])
    assert len(data["result"]["events"]) == 1
    assert "BEGIN:VCALENDAR" in data["result"]["ics_content"]
    assert upstream.services == ["nebius", "tavily", "nebius"]
    assert data["evidence"] == {"mode": "web", "gap": False}
    assert [s["status"] for s in data["sources"]] == ["failed"] * 5 + ["used"]


async def test_synthesize_reads_the_chosen_sources_and_reports_on_each():
    upstream = Upstream(
        pages=source_pages(),
        nebius_outputs=[valid_forecast(events=[valid_event(source_urls=[CAFE_URL])])],
    )
    general = {"mode": "general", "sunSign": "Scorpio", "targetMonth": "November 2026"}
    body = {
        "profile": {**general, "priorities": []},
        "sources": {"disabledCurated": ["rux-youtube", "astrology-zone", "no-such-source"]},
    }
    async with api_client(make_deps(upstream)) as client:
        response = await client.post(SYNTHESIZE, json=body, headers=SSE)
    name, payload = parse_sse(response.text)[-1]
    assert name == "result"
    assert payload["evidence"] == {"mode": "curated", "gap": False}
    assert [(s["id"], s["status"]) for s in payload["sources"]] == [
        ("cafe-astrology", "used"),
        ("astrostyle", "used"),
        ("sally-kirkman", "used"),
    ]
    assert upstream.services == ["nebius"]


async def test_curated_sources_are_listed_for_the_sources_tab():
    async with api_client(make_deps()) as client:
        response = await client.get("/api/sources/curated")
    sources = response.json()["sources"]
    assert [s["id"] for s in sources] == [
        "rux-youtube",
        "cafe-astrology",
        "astrology-zone",
        "astrostyle",
        "sally-kirkman",
    ]
    assert all(s["language"] == "en" and s["url"].startswith("https://") for s in sources)
    assert set(sources[0]) == {"id", "name", "author", "type", "url", "language", "cadence"}


async def test_missing_config_is_503_but_the_profile_is_still_saved():
    deps = make_deps(env={})
    async with api_client(deps) as client:
        response = await client.post(SYNTHESIZE, json=BODY)
    assert response.status_code == 503
    assert "NEBIUS_API_KEY" in response.json()["error"]
    assert len(profile_files(deps)) == 1


async def test_upstream_failure_and_pipeline_timeout_statuses():
    async with api_client(make_deps(Upstream(nebius_status=500))) as client:
        response = await client.post(SYNTHESIZE, json=BODY)
    assert response.status_code == 502
    assert "HTTP 500" in response.json()["error"]

    upstream = Upstream(delay=0.5)
    deps = make_deps(upstream)
    deps.timeout_seconds = 0.2
    async with api_client(deps) as client:
        response = await client.post(SYNTHESIZE, json=BODY)
    assert response.status_code == 504
    assert "timed out" in response.json()["error"]
    await asyncio.sleep(0.6)
    assert len(upstream.calls) == 1


async def test_sse_stream_emits_ordered_progress_steps_then_result():
    async with api_client(make_deps()) as client:
        response = await client.post(SYNTHESIZE, json=BODY, headers=SSE)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.text.startswith(": connected\n\n")

    events = parse_sse(response.text)
    assert [name for name, _ in events] == ["progress"] * 4 + ["result"]
    assert [data["step"] for name, data in events if name == "progress"] == [1, 2, 3, 4]
    payload = events[-1][1]
    assert len(payload["result"]["events"]) == 1
    assert re.match(UUID_PATTERN, payload["profileId"])


async def test_sse_error_event_on_upstream_failure():
    async with api_client(make_deps(Upstream(nebius_status=503))) as client:
        response = await client.post(SYNTHESIZE, json=BODY, headers=SSE)
    events = parse_sse(response.text)
    assert events[-1][0] == "error"
    assert "HTTP 503" in events[-1][1]["error"]
    assert "result" not in [name for name, _ in events]


@pytest.mark.parametrize("headers", [{}, SSE])
async def test_early_client_disconnect_cancels_the_active_upstream_call(headers):
    """Runs a real server: the client hangs up while the first upstream call is in flight."""
    upstream = Upstream(delay=0.25)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    deps = make_deps(upstream, port=port)
    server = uvicorn.Server(uvicorn.Config(create_app(deps), log_level="warning", lifespan="off"))
    serving = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        while not server.started:
            await asyncio.sleep(0.01)
        body = json.dumps(BODY).encode()
        head = f"POST {SYNTHESIZE} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
        head += "".join(f"{k}: {v}\r\n" for k, v in headers.items())
        head += f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n"
        _, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(head.encode() + body)
        await writer.drain()
        await asyncio.sleep(0.1)
        assert len(upstream.calls) == 1
        writer.close()
        await asyncio.sleep(0.7)
        assert len(upstream.calls) == 1, upstream.services
    finally:
        server.should_exit = True
        await serving


async def test_built_frontend_is_served_with_spa_fallback(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("secret")
    async with api_client(make_deps(), static_dir=tmp_path) as client:
        assert (await client.get("/")).text == "<html>app</html>"
        assert (await client.get("/assets/app.js")).text == "console.log(1)"
        assert (await client.get("/some/client/route")).text == "<html>app</html>"
        assert (await client.get("/%2e%2e/secret.txt")).text == "<html>app</html>"
        assert (await client.get("/api/unknown")).status_code == 404
        assert (await client.get("/", headers={"Host": "evil.example.com"})).status_code == 403
