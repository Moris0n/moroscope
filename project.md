# Moroscope

Mobile-first PWA that builds a personalized, source-cited monthly astrology forecast
from a user's birth profile, exportable as an `.ics` calendar. Originally scaffolded in
Google AI Studio (as "CelestialPulse").

## Stack
- Frontend: React 19, Vite 8, Tailwind CSS 4, lucide-react, motion, vite-plugin-pwa
- Backend: Python 3.12+, FastAPI + Uvicorn, httpx (`backend/`, managed with `uv`)
- LLM: Nebius (OpenAI-compatible `/chat/completions`, JSON mode)
- Search: Tavily (`/search`, advanced depth)
- Tests: pytest (backend), `node:test` + `tsx` (frontend)

## Commands
| Task | Command |
|------|---------|
| Install | `npm install` and `cd backend && uv sync` |
| API dev server (http://127.0.0.1:8000) | `npm run dev:api` |
| Frontend dev server (http://localhost:3000, proxies `/api`) | `npm run dev` |
| Typecheck | `npm run lint` |
| Frontend tests | `npm test` |
| Backend tests | `npm run test:api` |
| Backend lint | `cd backend && uv run ruff check .` |
| Build frontend | `npm run build` |
| Production (backend serves `dist/`) | `cd backend && APP_ENV=production uv run python -m app` |

## Configuration (`.env` at the repo root)
Required for the forecast pipeline: `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, `TAVILY_API_KEY`.
Optional: `PORT` (default 8000), `HOST` (default 127.0.0.1), `ALLOWED_HOSTS`, `DATA_DIR`, `APP_ENV`.

## Architecture
### Backend (`backend/app/`)
- `main.py` – FastAPI app factory, host/origin guard, request parsing, SSE, static frontend serving.
  - `POST /api/profiles` – validates and atomically writes `data/profiles/<uuid>.json` (0600).
  - `POST /api/horoscope/synthesize` – runs the pipeline; SSE (`Accept: text/event-stream`,
    events `progress` / `result` / `error`) or plain JSON.
- `pipeline.py` – the 4 steps:
  1. Save profile snapshot
  2. Nebius "query agent" → one search query (`QUERY_AGENT_PROMPT`)
  3. Tavily search (≤10 results, content truncated)
  4. Nebius "forecast agent" → `{overall_theme, events[]}` (`FORECAST_AGENT_PROMPT`),
     validated (dates within month, citations ⊆ Tavily URLs, allowed topics/impact types),
     then `.ics` built deterministically.
- `validation.py` – profile and forecast validation, limits, month parsing.
- `ics.py` – RFC 5545 calendar generation. `prompts.py` – the two system prompts.
- `config.py` – environment configuration and the allowed-hosts list.
- Security: host allow-list (localhost by default, `ALLOWED_HOSTS` to override), same-origin check,
  2 MB body limit, 180 s timeout, cancellation when the client disconnects.

### Frontend (`src/`)
- `App.tsx` – top-level state and layout; tabs: Dashboard, Sources, Natal Profile.
  State persisted in localStorage (`moroscope_*_v1` keys; old `celestialpulse_*` keys are still read).
- `api/forecastApi.ts` – the two API calls. `hooks/useForecast.ts` – forecast request state.
- `components/` – Navigation, ProfileSummary, ForecastResults, AgentProgress, TransitHeatmapMatrix,
  SourcesManager, NatalProfilePanel, PWAInstallButton, OfflineIndicator.
  EnergyWaveChart and ActivityScheduler are kept but not rendered (they run on synthetic data).
- `utils/forecastShared.ts` – client-side checks, month parsing, profile repair.
- `utils/forecastHelpers.ts` – SSE parser/reader, `.ics` download, monthly heatmap.
- `utils/storage.ts` – localStorage helpers.
- `utils/astrologyEngine.ts` – heuristic sign calculations (to be replaced in Phase 1).
- `utils/timezoneEngine.ts` – IANA offset helpers, timezone options.
- `types/astrology.ts` – domain types.

## Status
### Real / production-quality
- Nebius → Tavily → Nebius forecast pipeline with strict validation and SSE progress
- Profile persistence, `.ics` export, monthly heatmap from generated events
- 87 backend tests (`backend/tests/`), 12 frontend tests (`test/forecast.test.ts`)

### Heuristic or not wired up yet
- Moon sign (sidereal-cycle approximation) and Rising sign (sunrise≈06:00 heuristic, ignores lat/long)
- Sources tab (the list is stored but the pipeline does not use it yet; it searches the open web)

## Known issues / TODO
The product plan and phased roadmap live in
[`implementation_plan.md`](.aistudio/artifacts/brain/d04094be-69b6-4d03-85cd-3b2d3db6ae2f/implementation_plan.md).
Phase 0 (Python backend and cleanup) is done. Remaining items from the code review:

- [ ] `backendUrl` override can't work (no CORS; origin must equal host) – add CORS or remove the setting
- [ ] Replace sign heuristics with a real ephemeris (Skyfield on the server) + birth geocoding (Phase 1)
- [ ] Wire the Sources tab into the pipeline (Tavily `include_domains`) (Phase 2)
- [ ] Rebuild the energy charts and schedule on real data (Phase 4)
- [ ] Request/response models are hand-validated dicts; move to Pydantic models and generated
      TypeScript types when the data model changes (Phase 3)
- [ ] `vite.config.ts` still disables HMR (an AI Studio setting)
