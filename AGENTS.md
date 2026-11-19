# Moroscope: notes for coding agents

## Layout
- `backend/`: Python API (FastAPI, managed with `uv`). `app/` is the code, `tests/` is pytest.
- `src/`: React + Vite frontend. `test/` holds its `node:test` tests.
- `project.md`: current state of the code. The product plan and roadmap are in
  `.aistudio/artifacts/brain/d04094be-69b6-4d03-85cd-3b2d3db6ae2f/implementation_plan.md`.

## Commands
- Frontend: `npm run dev` (port 3000, proxies `/api` to port 8000), `npm run lint` (tsc),
  `npm test`, `npm run build`.
- After changing `backend/app/models.py`: `npm run gen:types`. It rewrites
  `backend/schema/api.schema.json` and `src/types/api.generated.ts` (both committed, never edited
  by hand); a backend test fails while the schema is out of date.
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
- Generating a forecast calls Nebius and Tavily with the keys in `.env` and costs money: one
  Extractor call per source document that is not cached, plus one Synthesizer call. For smoke
  tests, override `NEBIUS_BASE_URL` and `DATA_DIR` so nothing real is called or written.
- `/api/chart` needs `backend/app/resources/de421.bsp` (17 MB, git-ignored). Fetch it once with
  `cd backend && uv run python scripts/fetch_ephemeris.py`; without it the chart tests fail and the
  endpoint answers 503.
- Backend tests never hit the network: upstream calls and source pages go through
  `httpx.MockTransport` (`backend/tests/helpers.py`; its `Upstream` tells the query agent, the
  Extractor and the Synthesizer apart by their system prompt, and the extractions run side by side,
  so never assert their order), the YouTube transcript and DNS lookups through
  fakes on `PipelineDeps`. The pages in `backend/tests/fixtures/` are hand-written stand-ins that
  copy only the structure of the real sites (headings, links); keep real site text out of them.
- A forecast reads the source sites directly (`backend/app/webpages.py`, `youtube.py`). When a
  site changes its layout its reader reports "no forecast" or "failed" instead of guessing. Check
  all of them against the live sites, free of charge, with
  `cd backend && uv run python scripts/check_sources.py --month "November 2026" --sign scorpio`,
  then fix the reader and its fixture together.
- Source texts are cached under `DATA_DIR/cache/sources/` (7 days; 6 hours for "not published
  yet"). Delete that directory to force a re-read.
- A forecast is built in two LLM steps (`backend/app/extract.py`, `forecast.py`). The Extractor
  gets one source document and nothing about the user; code keeps an event only if its quote is in
  the document and names the day. The Synthesizer gets the verified events (never source text or
  quotes) and only words them: dates, types, life areas, houses, citations and ids are set in code.
  Keep it that way: no rule that a model could break may be enforced only by a prompt.
  The one thing shown whose dates are not checked against the text is a sky event's active window
  (the days a source says it is felt; a side is kept only when the quote names that day or counts days before or after); events merge on their exact day, never on the window.
- Extractor answers are cached under `DATA_DIR/cache/extractions/`, keyed by the document text,
  sign, month, model and the prompt text, so editing `EXTRACTOR_PROMPT` or the model makes every
  document cost a call again. The cache holds the unchecked answers; the checks run on every read.
- Privacy rule, covered by tests: name, birth date, time and place never go to Nebius or Tavily.
  The Extractor gets the month, the sign and one document. The Synthesizer gets the sign and, of
  the user, only the priorities text built in code from the focus areas and the life context
  (`backend/app/priorities.py`), the dated plans and the pasted excerpt. The life context is never
  written to `data/profiles` or to the extraction cache. Validation errors name the field and never repeat
  the submitted value (`models.error_messages`).
- One taxonomy everywhere: the 10 life areas and 3 event types in `backend/app/models.py`
  (`LifeArea`, `EventType`). The frontend labels in `src/utils/forecastShared.ts`, the list in
  `EXTRACTOR_PROMPT` and the house table in `backend/app/priorities.py` must name the same ids.
  The same goes for the planets and aspects (`Planet`, `Aspect`; `ASPECT_LABELS` in the frontend).
- Generated forecasts are kept in the browser only (`moroscope_forecasts_v1`, one versioned record
  per month, `src/utils/forecastStore.ts`). They hold personal notes: nothing of them is stored on
  the server.
- `backend/notebooks/forecast_walkthrough.ipynb` runs the pipeline step by step for a profile in
  `data/profiles` and prints the source texts, the priorities, each extraction and its checks, the
  ranking, the Synthesizer's prompt and raw answer and the assembled forecast (kernel:
  `backend/.venv`). Reading the sites is free; the Nebius calls only run with `RUN_LLM = True`. Its outputs contain personal data: clear them before committing. It follows
  `run_forecast_pipeline` by hand, so update it when the order of the pipeline steps changes.
