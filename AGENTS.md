# Moroscope: notes for coding agents

## Layout
- `backend/`: Python API (FastAPI, managed with `uv`). `app/` is the code, `tests/` is pytest.
- `src/`: React + Vite frontend. `test/` holds its `node:test` tests.
- `project.md`: current state of the code. The product plan and roadmap are in
  `.aistudio/artifacts/brain/d04094be-69b6-4d03-85cd-3b2d3db6ae2f/implementation_plan.md`.

## Commands
- Frontend: `npm run dev` (port 3000, proxies `/api` to port 8000), `npm run lint` (tsc),
  `npm test`, `npm run build`.
- Backend: `npm run dev:api` (or `cd backend && uv run python -m app --reload`),
  `npm run test:api` (or `cd backend && uv run pytest`),
  `cd backend && uv run ruff check . && uv run ruff format --check .`.
- Run all of lint, both test suites and the build before calling a change done.

## Things to know
- Node may not be on PATH in non-interactive shells; it is installed through nvm
  (`~/.nvm/versions/node/*/bin`). `uv` is in `~/.local/bin`.
- npm is the package manager (single lockfile: `package-lock.json`).
- `backend/pyproject.toml` pins `exclude-newer` for uv; bump the date deliberately when
  upgrading dependencies.
- The API rejects requests whose `Host` is not allow-listed and whose `Origin` does not match
  `Host`. The Vite proxy must keep `changeOrigin: false` or browser requests get a 403.
- Generating a forecast calls Nebius and Tavily with the keys in `.env` and costs money. For
  smoke tests, override `NEBIUS_BASE_URL` and `DATA_DIR` so nothing real is called or written.
- `/api/chart` needs `backend/app/resources/de421.bsp` (17 MB, git-ignored). Fetch it once with
  `cd backend && uv run python scripts/fetch_ephemeris.py`; without it the chart tests fail and the
  endpoint answers 503.
- Backend tests never hit the network: upstream calls go through `httpx.MockTransport`
  (`backend/tests/helpers.py`).
