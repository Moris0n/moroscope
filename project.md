# Moroscope

Mobile-first PWA that builds a source-cited monthly astrology forecast from astrologers the
user trusts, personalised with the user's signs and life situation (or general, for a sign only),
exportable as an `.ics` calendar. Originally scaffolded in
Google AI Studio (as "CelestialPulse").

## Stack
- Frontend: React 19, Vite 8, Tailwind CSS 4, lucide-react, motion, vite-plugin-pwa
- Backend: Python 3.12+, FastAPI + Uvicorn, Pydantic v2, httpx, Skyfield (`backend/`, managed with `uv`)
- LLM: Nebius (OpenAI-compatible `/chat/completions`, JSON mode). Each source text (up to about
  30,000 characters) is sent in a call of its own, so `NEBIUS_MODEL` needs a context window of 16k
  tokens or more.
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
    personalNote?, sourceUrls, inFocus, planets?, aspect?, house?, activeWindows?}`. A source report entry also has
    `events` (verified) and `dropped` (failed the check against the source text).
- `pipeline.py` – the steps (five progress steps):
  1. Save the profile snapshot (never the life context).
  2. Read the selected sources for the primary sign (Rising if it leads, else Sun; in general mode
     the chosen sign). Active user sources are used alone ("exclusive"); otherwise the enabled
     curated ones. User-added bare sites are searched with Tavily `include_domains`.
     With fewer than 2 usable curated sources: Nebius "query agent" plus an open Tavily search.
     With no documents at all: an empty forecast with `evidence.gap`, without any LLM call. In
     exclusive mode the search is never broadened; the UI offers "Also use default sources".
  3. Extract (`extract.py`): one Nebius call per document, three at a time, with the month, the
     sign and that document only (`EXTRACTOR_PROMPT`). Each returned event is then checked in
     code. If the Extractor fails for every document the request fails (502); if it fails for
     some, those sources are reported as failed. Then rank (`priorities.py`, `forecast.py`). With
     no verified event: an empty forecast, without a Synthesizer call.
  4. Synthesize: one Nebius call (`SYNTHESIZER_PROMPT`) with `{month, sign, priorities, events,
     upcomingEvents?, customExcerpt?}`; no source text. It returns `{theme, groups: [{eventIds,
     title, summary, personalNote?}]}`.
  5. Assemble (`forecast.py`) and build the `.ics` deterministically.
- `extract.py` – the Extractor call, its cache (`DATA_DIR/cache/extractions/`, keyed by document
  text, sign, month, model and prompt; no user data) and the checks, as pure functions: the quote
  must be in the document (case, punctuation and spacing ignored; parts around "..." in order) and
  must name the day the event starts or ends on, in digits or spelled out (any day of a span of
  up to three days; an event spanning the whole month is exempt); a span reaching out of the month is cut to it; an end date equal to the
  start is left out. A failed check drops that event only. A sky event has one exact day; the days the source says
  it is felt are its active window (`activeFrom` / `activeUntil`), kept per source; its dates are not checked against the text, but a side is
  kept only when the quote names that day or counts days before (after) the event ("the day
  before", "3 days after"), so vague windows ("for the rest of the year") are not shown; a
  side that lands on another event of the same document about the same matter is left out too
  ("on the 4th and the 28th" is two events). A sky event that arrives with an end date although its quote names only the
  first day is repaired: the end date becomes the window. The source's tone becomes the event
  type (favourable → `goodTime`, caution → `caution`, neutral → `keyDate`). Event ids are a hash
  of month, document URL, dates and quote, so they survive regeneration while the extraction is
  cached.
- `priorities.py` – the house table of the 10 life areas, life context → priorities (for example
  looking for a job → career, houses 10 and 6; children → family, houses 5 and 4), the ranking
  (hand-picked focus areas in their order, then the derived ones, then the rest; never a filter)
  and the narrative: a fixed template that says only what the user stated, the one description
  of the user the Synthesizer gets. Whole-sign house of an event from the sign it happens in,
  counted from the reading sign, when the source states no house.
- `forecast.py` – ranking of the verified events (sets `inFocus`; when code computed the house,
  the life areas of that house are added to the event's tags), the Synthesizer's input, and the assembly: ids that do not exist
  or are used twice are skipped, of a group the largest part whose members have the same dates
  is merged into one event and the others stay separate (citations, active windows, life areas and planets from all members; a key date when their
  directions differ), events the Synthesizer left out are appended in the Extractor's words,
  the result is sorted by date, personal notes are dropped unless a life context was sent.
- `llm.py` – the Nebius chat call (JSON mode, `max_tokens`, one retry for a cut-off or
  unparseable answer) and the JSON POST helper.
- `models.py` – Pydantic models for every request, the three agents' answers and every response,
  and the taxonomy: 10 life areas (`career`, `money`, `love`, `family`, `health`, `community`,
  `communication`, `learning`, `creativity`, `rest`), 3 event types (`keyDate`, `goodTime`,
  `caution`), planets and aspects. Wire format is camelCase; types are strict; unknown fields
  are ignored. Error messages give the field path and the problem, never the submitted value.
- `sources.py` – the curated list (Written in the Stars by Rux on YouTube, Cafe Astrology,
  Astrology Zone, Astrostyle, Sally Kirkman), the request's source settings, selection, concurrent
  reading with a per-source report (`used` / `no_forecast` / `failed`), the file cache and the
  size budget of the texts.
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
  `prompts.py` – the three system prompts (query agent, Extractor, Synthesizer).
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
- `components/` – Navigation, ProfileSummary, ForecastResults (events in focus are marked; planets,
  aspect, house and each source's active window when known; verified events per source), AgentProgress (five steps),
  TransitHeatmapMatrix (rows: the focus areas, then the other areas that have events),
  SourcesManager, NatalProfilePanel, BirthPlaceSearch, PWAInstallButton, OfflineIndicator.
  EnergyWaveChart and ActivityScheduler are kept but not rendered (they run on synthetic data).
- `utils/forecastShared.ts` – client-side checks, month parsing, profile repair, what is sent
  for a profile (`profileRequestBody`: a general profile sends only sign, month and focus areas),
  life areas and event types with their labels, life-context options, source-settings repair.
- `utils/forecastHelpers.ts` – SSE parser/reader, `.ics` download, monthly heatmap and its rows.
- `utils/storage.ts` – localStorage helpers.
- `utils/astrologyEngine.ts` – zodiac metadata and the synthetic energy data for the hidden charts.
- `utils/timezoneEngine.ts` – IANA offset helpers, timezone options.
- `types/api.generated.ts` – the request and response types, generated from the backend models.
  `types/astrology.ts` – names them for the app and adds the device-only ones (`UserProfile`,
  `StoredForecast`).

## Status
### Real / production-quality
- Forecast pipeline on directly read, month-checked sources: per-source extraction with every
  event checked against the source text in code, a Synthesizer that can only word existing
  events, SSE progress, a per-source report and an honest evidence gap
- Curated and user-added sources (pages, sites, YouTube channels), exclusive mode
- Onboarding with personalised and general mode; of the life context only the priorities text
  and the dated plans reach the Synthesizer
- Life areas end to end: focus picker, event tags, month map rows, `.ics` text; event types
  (key date / good time / be careful); personal notes for personal profiles; event ids that
  survive regeneration
- Profile persistence, `.ics` export, month map from generated events, forecasts kept per month on
  the device
- Sun, Moon and Rising signs from a real ephemeris, checked against published charts; birth-place
  search with coordinates and timezone
- 231 backend tests (`backend/tests/`), 27 frontend tests (`test/forecast.test.ts`)

### Fragile by nature
- The site readers depend on each site's page layout, and the YouTube transcript download is
  unofficial (often blocked from cloud hosts). Both fail closed: the source is reported as
  unreadable and the forecast is built from the others. `scripts/check_sources.py` shows which.
- Astrology Zone asks crawlers for a 10 s delay; the reader pauses 1 s between its pages and relies
  on the 7-day cache.

## Known issues / TODO
The product plan and phased roadmap live in
[`implementation_plan.md`](.aistudio/artifacts/brain/d04094be-69b6-4d03-85cd-3b2d3db6ae2f/implementation_plan.md).
Phases 0 to 2 and Phase 3a (life areas, new forecast model, Pydantic models, the two-step
Extractor / Synthesizer pipeline) are done. Next: 3b
(calendar grid, "Good time to…" list, event detail), then 3c (per-event and filtered `.ics`).
Remaining items:

- [ ] Real runs of the two-step pipeline (Pisces, November 2026, `Qwen/Qwen3-235B-A22B-Instruct-2507`,
      all five sources: 6 calls, about 45,000 tokens): 47 events returned, 44 verified, 21 forecast
      entries; the new moon merged from 5 sources. Nothing was made up. Still open: the
      Extractor sometimes picks a quote that does not name the day, which drops a real event (3 of
      47); "in focus" marked 20 of 21 events for a profile with three priorities, so it says
      little; a merged entry takes the id of its first-ranked member, so the id can change with
      the focus areas or the sources (to settle with the month review)
- [ ] The theme, summaries and personal notes are free text: they could still mention a date that
      is not an event. Dates, citations and the event list itself can no longer be made up.
- [ ] Model choice. Reasoning models spend the answer allowance on thinking:
      `nvidia/nemotron-3-super-120b-a12b` used 7,432 of 8,000 output tokens on it and was cut off
      twice. Use a non-reasoning model with JSON mode. With the earlier single-call pipeline,
      `Qwen/Qwen3-30B-A3B-Instruct-2507` made up an event on the date of the user's own upcoming
      event and `Qwen/Qwen3-235B-A22B-Instruct-2507` did not, in 9 s instead of 66 s; both skipped
      the source's date ranges
- [ ] A first forecast for a month and sign makes one call per document plus one; a web-search
      fallback can mean up to 10 small extraction calls. Later ones reuse the extraction cache,
      which is never pruned
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
