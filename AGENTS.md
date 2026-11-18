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
- Backend tests never hit the network: upstream calls and source pages go through
  `httpx.MockTransport` (`backend/tests/helpers.py`), the YouTube transcript and DNS lookups through
  fakes on `PipelineDeps`. The pages in `backend/tests/fixtures/` are hand-written stand-ins that
  copy only the structure of the real sites (headings, links); keep real site text out of them.
- A forecast reads the source sites directly (`backend/app/webpages.py`, `youtube.py`). When a
  site changes its layout its reader reports "no forecast" or "failed" instead of guessing. Check
  all of them against the live sites, free of charge, with
  `cd backend && uv run python scripts/check_sources.py --month "November 2026" --sign scorpio`,
  then fix the reader and its fixture together.
- Source texts are cached under `DATA_DIR/cache/sources/` (7 days; 6 hours for "not published
  yet"). Delete that directory to force a re-read.
- Privacy rule, covered by tests: name, birth date, time and place never go to Nebius or Tavily.
  The forecast agent gets signs, focus topics and (personal mode) the life context; the life
  context is never written to `data/profiles`.
- `backend/notebooks/forecast_walkthrough.ipynb` runs the pipeline step by step for a profile in
  `data/profiles` and prints the source texts, the prompt, the raw LLM answer and the validation
  result (kernel: `backend/.venv`). Reading the sites is free; the Nebius call only runs with
  `RUN_LLM = True`. Its outputs contain personal data: clear them before committing. It follows
  `run_forecast_pipeline` by hand, so update it when the order of the pipeline steps changes.
