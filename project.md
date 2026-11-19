# Moroscope

Mobile-first PWA that builds a source-cited monthly astrology forecast from astrologers the
user trusts, personalised with the user's signs and life situation (or general, for a sign only),
exportable as an `.ics` calendar. Originally scaffolded in
Google AI Studio (as "CelestialPulse").

## Stack
- Frontend: React 19, Vite 8, Tailwind CSS 4, lucide-react, motion, vite-plugin-pwa
- Backend: Python 3.12+, FastAPI + Uvicorn, Pydantic v2, httpx, Skyfield (`backend/`, managed with `uv`)
- LLM: Nebius (OpenAI-compatible `/chat/completions`, JSON mode). A forecast prompt holds up to
  about 90,000 characters of source text, so `NEBIUS_MODEL` needs a context window of 32k tokens or more.
- Sources: read directly over HTTP; YouTube transcripts with `youtube-transcript-api` (unofficial)
- Search: Tavily (`/search`, advanced depth), only as a fallback and for user-added bare sites
- Tests: pytest (backend), `node:test` + `tsx` (frontend)

## Commands
| Task | Command |
|------|---------|
| Install | `npm install` and `cd backend && uv sync && uv run python scripts/fetch_ephemeris.py` |
| API dev server (http://127.0.0.1:8000) | `npm run dev:api` |
| Frontend dev server (http://localhost:3000, proxies `/api`) | `npm run dev` |
| Typecheck | `npm run lint` |
| Frontend tests | `npm test` |
| Backend tests | `npm run test:api` |
| Backend lint | `cd backend && uv run ruff check .` |
| Check the sources against the live sites (free) | `cd backend && uv run python scripts/check_sources.py --month "November 2026"` |
| See a forecast being built step by step (LLM call off by default) | open `backend/notebooks/forecast_walkthrough.ipynb` with the `backend/.venv` kernel |
| Regenerate the frontend types after a change to `backend/app/models.py` | `npm run gen:types` |
| Build frontend | `npm run build` |
| Production (backend serves `dist/`) | `cd backend && APP_ENV=production uv run python -m app` |

## Configuration (`.env` at the repo root)
Required for the forecast pipeline: `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, `TAVILY_API_KEY`.
Optional: `PORT` (default 8000), `HOST` (default 127.0.0.1), `ALLOWED_HOSTS`, `DATA_DIR`, `APP_ENV`.

## Architecture
### Backend (`backend/app/`)
- `main.py` – FastAPI app factory, host/origin guard, request parsing, SSE, static frontend serving.
  - `POST /api/chart` – Sun, Moon and Rising sign for birth data (`{birthDate, birthTime?, timeKnown,
    place: {tz, lat?, lon?}}`). Rising needs a known time and coordinates; with an unknown time,
    `sunUncertain` / `moonUncertain` say whether the sign changed during the birth day.
  - `GET /api/places?q=` – offline city search; returns label, coordinates and IANA timezone.
  - `POST /api/profiles` – validates and atomically writes `data/profiles/<uuid>.json` (0600).
  - `GET /api/sources/curated` – the default source list for the Sources tab.
  - `POST /api/horoscope/synthesize` – runs the pipeline; SSE (`Accept: text/event-stream`,
    events `progress` / `result` / `error`) or plain JSON. Body: `{profile, profileId?,
    customExcerpt?, sources?: {disabledCurated, user: [{id, url, active}], includeCurated}}`.
    Answer: `{result: {theme, events, icsContent}, profileId, sources: [per-source report],
    evidence: {mode, gap}}`. An event is `{id, date, endDate?, title, type, lifeAreas, summary,
    personalNote?, sourceUrls}`.
- `pipeline.py` – the steps:
  1. Save the profile snapshot (never the life context).
  2. Read the selected sources for the primary sign (Rising if it leads, else Sun; in general mode
     the chosen sign). Active user sources are used alone ("exclusive"); otherwise the enabled
     curated ones. User-added bare sites are searched with Tavily `include_domains`.
     With fewer than 2 usable curated sources: Nebius "query agent" plus an open Tavily search.
     With no documents at all: an empty forecast with `evidence.gap`, without any LLM call. In
     exclusive mode the search is never broadened; the UI offers "Also use default sources".
  3. Nebius "forecast agent" → `{theme, events[]}` (`FORECAST_AGENT_PROMPT`) from
     `{month, person, documents}`; checked by `forecast.py`.
  4. `.ics` built deterministically.
- `models.py` – Pydantic models for every request, the two agents' answers and every response,
  and the taxonomy: 10 life areas (`career`, `money`, `love`, `family`, `health`, `community`,
  `communication`, `learning`, `creativity`, `rest`) and 3 event types (`keyDate`, `goodTime`,
  `caution`). Wire format is camelCase; types are strict; unknown fields are ignored. Error
  messages give the field path and the problem, never the submitted value.
- `forecast.py` – the rules a model cannot check alone (dates within the month, citations ⊆
  document URLs, chronological order, one chosen focus area per event), the event ids (a hash of
  month, dates, title and type, assigned by the server, with a suffix on a collision) and the
  personal notes, which are dropped unless a life context was sent.
- `sources.py` – the curated list (Written in the Stars by Rux on YouTube, Cafe Astrology,
  Astrology Zone, Astrostyle, Sally Kirkman), the request's source settings, selection, concurrent
  reading with a per-source report (`used` / `no_forecast` / `failed`), the file cache and the
  prompt-size budget.
- `webpages.py` – page fetching (public addresses only, every redirect hop checked, 3 MB cap),
  HTML to headings and paragraphs (standard library), one reader per curated site that checks the
  month and year and cuts out the sign, and a generic reader for user-added pages.
- `youtube.py` – finds the month's video in the channel RSS feed, reads the per-sign timestamps
  from the description and cuts the sign's chapter out of the transcript (cited with a `&t=`
  link; the general introduction of the video is not sent). User-added channel or video URLs resolve to their channel.
- `chart.py` – the chart calculation: Skyfield with the JPL DE421 ephemeris (`resources/de421.bsp`,
  17 MB, downloaded by `scripts/fetch_ephemeris.py`, not in git; birth years 1900 to 2050).
- `places.py` – search over `resources/cities.tsv` (about 34,000 GeoNames cities with a population
  over 15,000, CC BY 4.0; rebuilt with `scripts/build_cities.py`). English/ASCII city names only.
- `validation.py` – month and date helpers, small format checks, parsing of model output.
- `ics.py` – RFC 5545 calendar generation (UID from the event id; the personal note is included).
  `prompts.py` – the two system prompts.
- `scripts/export_schema.py` – writes `schema/api.schema.json` from the models; the frontend
  types are generated from it.
- `config.py` – environment configuration and the allowed-hosts list.
- Security: host allow-list (localhost by default, `ALLOWED_HOSTS` to override), same-origin check,
  2 MB body limit, 180 s timeout, cancellation when the client disconnects.

### Frontend (`src/`)
- `App.tsx` – top-level state and layout; onboarding, then tabs: Dashboard, Sources, Natal Profile.
  State persisted in localStorage (`moroscope_*_v1` keys; old `celestialpulse_*` keys are still read).
  Focus topics stored before the life areas existed (`priorities`) are converted on load.
- `components/Onboarding.tsx` – first run: personalised (birth details, life context, focus
  topics) or general (pick a sign, nothing else asked). Works on a draft until the last step.
  Profiles stored before onboarding existed (no `mode`) count as onboarded and personal.
  `LifeContextForm.tsx`, `SignPicker.tsx` are shared with the Profile tab, where a general user can
  personalise and a personal user can remove all personal details.
- `api/forecastApi.ts` – profile and forecast calls. `hooks/useForecast.ts` – forecast request state
  and the stored forecasts. `utils/forecastStore.ts` – the latest forecast per month, kept on the
  device as versioned records (`{version, month, forecast}`, newest 6; a failed regeneration keeps
  the old one; removing the personal details deletes them). A forecast made for another sign or
  mode than the current profile is marked as such.
- `api/chartApi.ts` – chart and place-search calls. `hooks/useNatalChart.ts` – recalculates the signs
  on the server whenever the birth data no longer matches the cached chart (`profile.chart.basis`).
  `utils/chart.ts` – the request body / cache key and applying a chart to the profile.
  Signs can still be overridden by hand; an override shows as "Manually set" and is replaced the
  next time the birth data changes.
- `api/sourcesApi.ts` – the curated source list. `components/SourcesManager.tsx` – switch default
  sources on and off, add / toggle / remove own sources, per-source status of the last forecast.
- `components/` – Navigation, ProfileSummary, ForecastResults, AgentProgress, TransitHeatmapMatrix,
  SourcesManager, NatalProfilePanel, BirthPlaceSearch, PWAInstallButton, OfflineIndicator.
  EnergyWaveChart and ActivityScheduler are kept but not rendered (they run on synthetic data).
- `utils/forecastShared.ts` – client-side checks, month parsing, profile repair, what is sent
  for a profile (`profileRequestBody`: a general profile sends only sign, month and focus areas),
  life areas and event types with their labels, life-context options, source-settings repair.
- `utils/forecastHelpers.ts` – SSE parser/reader, `.ics` download, monthly heatmap.
- `utils/storage.ts` – localStorage helpers.
- `utils/astrologyEngine.ts` – zodiac metadata and the synthetic energy data for the hidden charts.
- `utils/timezoneEngine.ts` – IANA offset helpers, timezone options.
- `types/api.generated.ts` – the request and response types, generated from the backend models.
  `types/astrology.ts` – names them for the app and adds the device-only ones (`UserProfile`,
  `StoredForecast`).

## Status
### Real / production-quality
- Forecast pipeline on directly read, month-checked sources with strict validation, SSE progress,
  a per-source report and an honest evidence gap
- Curated and user-added sources (pages, sites, YouTube channels), exclusive mode
- Onboarding with personalised and general mode; life context reaches the forecast agent only
- Life areas end to end: focus picker, event tags, month map rows, `.ics` text; event types
  (key date / good time / be careful); personal notes for personal profiles; stable event ids
- Profile persistence, `.ics` export, month map from generated events, forecasts kept per month on
  the device
- Sun, Moon and Rising signs from a real ephemeris, checked against published charts; birth-place
  search with coordinates and timezone
- 179 backend tests (`backend/tests/`), 25 frontend tests (`test/forecast.test.ts`)

### Fragile by nature
- The site readers depend on each site's page layout, and the YouTube transcript download is
  unofficial (often blocked from cloud hosts). Both fail closed: the source is reported as
  unreadable and the forecast is built from the others. `scripts/check_sources.py` shows which.
- Astrology Zone asks crawlers for a 10 s delay; the reader pauses 1 s between its pages and relies
  on the 7-day cache.

## Known issues / TODO
The product plan and phased roadmap live in
[`implementation_plan.md`](.aistudio/artifacts/brain/d04094be-69b6-4d03-85cd-3b2d3db6ae2f/implementation_plan.md).
Phases 0 to 2 and Phase 3a (life areas, new forecast model, Pydantic models) are done. Next: 3b
(calendar grid, "Good time to…" list, event detail), then 3c (per-event and filtered `.ics`).
Remaining items:

- [ ] Model choice. Reasoning models spend the answer allowance on thinking:
      `nvidia/nemotron-3-super-120b-a12b` used 7,432 of 8,000 output tokens on it and was cut off
      twice. Use a non-reasoning model with JSON mode. One real run (Astrostyle only) with
      `Qwen/Qwen3-30B-A3B-Instruct-2507` gave a valid forecast of 7 events, 6 with correct
      source-backed dates, but it also made up an event on the date of the user's own upcoming
      event, which validation cannot catch, and it skipped the source's date ranges.
      `Qwen/Qwen3-235B-A22B-Instruct-2507` on the same input gave 5 events, all source-backed and
      none made up, in 9 s instead of 66 s; it also skipped the date ranges and tagged events with
      the focus areas where the source points to another life area. `.env` still names the 30B model
- [ ] The forecast request now sets `max_tokens` (8,000, `NEBIUS_MAX_OUTPUT_TOKENS`)
- [ ] The server no longer checks `backendUrl` (it is a browser-only setting and is ignored)

- [ ] `backendUrl` override can't work (no CORS; origin must equal host) – add CORS or remove the setting
- [ ] A forecast for a personal profile still stores name and birth data in `data/profiles` on the server
- [ ] YouTube videos without per-sign timestamps are skipped when longer than one document
- [ ] Before a public launch: transcript download from a server (proxy or paid service), the
      crawl delay, and the copyright position of sending source text to the LLM
- [ ] Place search knows only English/ASCII city names ("Munich", not "München") and no villages
- [ ] Rebuild the energy charts and schedule on real data (Phase 4)
- [ ] `vite.config.ts` still disables HMR (an AI Studio setting)
