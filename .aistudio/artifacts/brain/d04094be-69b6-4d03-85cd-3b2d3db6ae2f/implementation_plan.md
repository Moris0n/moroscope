# Moroscope: Personal Monthly Astrology Planner

Moroscope turns a user's birth chart, real-life context and trusted astrology sources into a **personal monthly planning tool**: key dates, "good time to…" windows and cautions per life area, shown as a visual month map and exportable to any calendar (`.ics`).

Astrology is framed as interpretive planning guidance, never as prediction, financial advice or medical advice.

> This plan replaces the original AI Studio design (Gemini, daily schedules, source crawling). For the current state of the code see [`project.md`](../../../../project.md).

## Confirmed decisions

| Topic | Decision |
|---|---|
| Backend | Python (FastAPI), migrated first, in Phase 0, as a 1:1 port with tests before any new feature |
| Sign derivation | Real ephemeris on the Python server (Skyfield) plus birth-place geocoding; the client caches the last chart for offline viewing |
| Storage | On the user's device only for now; accounts in a later phase |
| Calendar | `.ics` download only (full month and per event) |
| Default sources | Curated list first, falling back to open web search |
| User sources | Exclusive: if the user added sources, only those are used |
| Energy charts | Hidden for now (they run on fake data); rebuilt later on real transits |
| Categories | 10 house-based life areas, replacing both current lists |

---

## 1. Vision

**Target user:** astrology-curious people who want actionable, dated guidance tailored to their situation (job hunt, new relationship, parenting, and so on), not generic sun-sign paragraphs.

**What they get each month:**
- the important events of the month, with dates
- when it is a good time to do specific things, per life area
- when to be careful
- a visual month view, and optionally the same content as calendar entries

---

## 2. Core features

### F1. Personal profile and chart derivation

**Birth data**
- Name (optional, a nickname is fine)
- Birth date
- Birth time, or "unknown"
- Birth place: city search that resolves to latitude, longitude and IANA timezone automatically
- Current timezone: auto-detected, can be overridden

**Derived "Big Three"**, computed on the server (`POST /api/chart`) with Skyfield:
- Sun and Moon sign from ecliptic longitude at the UTC birth instant.
- Rising sign (Ascendant) from local sidereal time and birth latitude, only when the birth time is known.
- Fallback: the Rising sign drives interpretation. If it is unknown, the Sun sign is used (solar houses) and the UI says so.
- Moon-sign uncertainty is flagged when the birth time is unknown and the Moon changed sign that day.
- The result is cached on the device. Viewing works offline; recalculating needs a connection.

**Life context** (all optional, used only to personalise the interpretation)
- Relationship: single / dating / in a relationship / married / separated / it's complicated, plus a "looking for a partner" flag.
- Work: employed / looking for a job / considering a change / self-employed / student / parental leave / retired.
- Family: has kids (count and age bands), expecting, caring for parents, living situation.
- Money focus: saving / big purchase / investing / debt / none.
- Health and wellbeing focus: fitness, sleep, stress, a specific habit.
- Current goals (free text, length-bounded).
- Known upcoming events this month (interview, move, wedding, trip) with dates.

**Focus selection:** the user picks and ranks the life areas (F3) they care about this month.

**Privacy rules**
- The profile stays on the device and is sent to the backend only for chart calculation and forecast generation.
- Identifying data (name, birth date, time, place) never goes into web search queries.
- The LLM receives life context as untrusted data, never as instructions.

### F2. Astrology sources

**Curated default list** (a maintained data file on the server): name, domain, type (column / blog / video / podcast), language, cadence, and the sign-page URL pattern if known.

**User sources:** add a site, domain or URL; enable, disable or remove it. Only http(s), deduplicated by domain.

**Retrieval logic**
1. The user has active sources: **exclusive** mode. Tavily `include_domains` is set to the user's domains only.
2. Otherwise: search the curated domains. If that returns too few dated, month-specific results, fall back to open web search.
3. Exclusive mode with no usable evidence: show an evidence-gap message with a one-click "also use default sources" retry. The search is never broadened silently.

Every event cites at least one retrieved URL (the existing guarantee stays). Per-source agreement is shown in the event detail.

### F3. Life areas

One taxonomy, used for profile focus, LLM tagging, map rows, filters and calendar export. It replaces both `ActivityCategory` and `LifePriority`.

| Life area | Houses | Examples of "good time to…" and cautions |
|---|---|---|
| Career & Work | 10, 6 | apply for jobs, pitch, ask for a raise, start a project |
| Money & Resources | 2, 8 | big purchases, investing, budgeting; caution on impulse spending |
| Love & Relationships | 5, 7 | dates, important conversations, commitments |
| Family & Home | 4 (+5 for kids) | family time, moving, home projects, parenting focus |
| Health & Wellbeing | 6, 1 | start a routine, check-ups, recovery |
| Friends & Community | 11 | networking, events, asking for help |
| Communication & Contracts | 3 (+ Mercury) | signing, negotiating, key emails; Mercury retrograde cautions |
| Learning & Travel | 9 | courses, exams, trips |
| Creativity & Fun | 5 | hobbies, creative launches, play |
| Rest & Inner Life | 12, 8 | rest windows, reflection, letting go |

**Event types**
- Key date
- Good time to…
- Be careful
- Sky event (from the ephemeris, Phase 4)

Life context boosts relevance. For example, "looking for a job" ranks Career events higher and phrases them as job-search actions; "has kids" adds a parenting angle to Family & Home.

### F4. Monthly output

**Month overview:** theme, the top 3 to 5 key dates, and an evidence / uncertainty note.

**Views**
- Calendar month grid, filterable by life area.
- Life-area × day map (an evolution of the existing heatmap).
- "Good time to…" list grouped by life area, with date windows.
- Event detail: dates, the transit, a personal note tying it to the user's situation, and sources.

**Export**
- Full-month `.ics`.
- Per-event `.ics` ("Add to calendar").
- Filtered by life area.
- Optional reminder (`VALARM`) the day before.
- Generated deterministically on the server, never by the LLM.

The month picker defaults to the current or next month.

### F5. Real sky layer (later)

The server computes the month's sky events with Skyfield: new and full moons, sign ingresses, retrograde stations, void-of-course Moon.

Uses:
- cross-check the dates the LLM returns
- add "Sky event" items
- rebuild the weekly energy chart and hourly view on real transits

### F6. Accounts (later)

Login, server-side encrypted profiles, multi-device sync, forecast history.

---

## 3. Architecture (target)

```
┌──────────────────────────────────────────────────────────────┐
│                  BROWSER / PWA (React + Vite)                │
│  Profile & life context · Sources · Month map · Calendar     │
│  Local storage: profile, sources, cached chart, forecasts    │
└───────────────────────────────┬──────────────────────────────┘
                                │  /api  (JSON + SSE)
┌───────────────────────────────▼──────────────────────────────┐
│                  PYTHON BACKEND (FastAPI)                    │
│  POST /api/chart                 Skyfield: Sun, Moon, Rising │
│  POST /api/profiles              until accounts exist        │
│  POST /api/horoscope/synthesize  forecast pipeline           │
│  GET  /api/sources/curated       default source list         │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
        Nebius (LLM)                     Tavily (search)
```

**Frontend**
- React + Vite PWA (stack unchanged).
- Profile and sources in local storage; renders the map and calendar; downloads `.ics`.
- TypeScript types generated from the backend OpenAPI schema (for example `openapi-typescript`).

**Backend**
- Python 3.12+, FastAPI + Uvicorn, Pydantic v2 models.
- httpx (async) for Nebius and Tavily.
- SSE via `sse-starlette`, with the same `progress` / `result` / `error` events as today.
- Skyfield for the ephemeris.
- ICS generation: a port of `ics.ts`, or the `icalendar` library.
- Tests: pytest + respx. Tooling: uv, ruff, mypy or pyright.

**Forecast pipeline**
1. Validate the profile (including life context) and the source configuration.
2. Query agent: 1 to 3 search queries (sign, month and year, focus areas; no personal data).
3. Tavily search using the F2 domain rules.
4. Forecast agent: events tagged with life areas, event type and a personal note.
5. Strict validation: dates within the month, citations limited to retrieved URLs, allowed enum values.
6. Deterministic `.ics`.

**Running it**
- Development: the Vite dev server proxies `/api` to FastAPI (two processes).
- Production: FastAPI serves the built `dist/` (single service), or static hosting is separate.

**Security carried over from the current server**
- Host and origin checks, made configurable for deployment.
- Body size limits.
- Request timeout and cancellation on client disconnect.
- Secrets only via environment variables.

---

## 4. Data model (target, summary)

- **UserProfile**
  - `birth`: `{ date, time?, timeKnown, place { label, lat, lon, tz } }`
  - `currentTimezone`
  - `chart`: `{ sun, moon, rising?, moonUncertain }`
  - `lifeContext`: `{ relationship, lookingForPartner, work, kids, family, moneyFocus, healthFocus, goals, upcomingEvents[] }`
  - `focusAreas`: `LifeArea[]`
- **Source**: `id`, `name`, `domain` / `url`, `type`, `language`, `origin` (`'curated' | 'user'`), `active`
- **ForecastEvent**: `date`, `endDate?`, `title`, `type`, `lifeAreas[]`, `summary`, `personalNote`, `sourceUrls[]`
- **MonthlyForecast**: `month`, `theme`, `keyDates[]`, `events[]`, `evidenceNote`, `generatedAt`

---

## 5. Roadmap

### Phase 0: Python backend and cleanup (done)
- Port `server.ts`, the validation and the ICS generation to FastAPI 1:1 (same API contract, same SSE events).
- Port the 32 tests to pytest.
- Add the Vite proxy; remove the Express / tsx server code.
- Unify naming (Moroscope vs CelestialPulse vs `react-example`).
- Remove Gemini leftovers.
- Keep a single lockfile.
- Make the default month dynamic.
- Split `App.tsx`.
- Hide the fake energy charts.

Notes from the port: validation is still hand-written (a 1:1 port of the TypeScript checks), and SSE uses Starlette's `StreamingResponse` instead of `sse-starlette`. Pydantic models and generated TypeScript types are deferred to Phase 3, when the data model changes.

### Phase 1: Profile and real chart
- Birth-place search and geocoding.
- `/api/chart` with Skyfield.
- Life-context form.
- Onboarding flow.

### Phase 2: Sources
- Curated list.
- User sources (exclusive mode).
- `include_domains` retrieval, fallback, and the evidence-gap retry.

### Phase 3: Life areas and monthly output
- Taxonomy end to end (Pydantic models, prompts, TypeScript types).
- Calendar grid and "Good time to…" list.
- Personal notes.
- Per-event and filtered `.ics`.

### Phase 4: Real sky layer
- Sky events, cross-checking, rebuilt energy charts.

### Phase 5: Accounts and deployment
- Auth, database, configurable hosting.

---

## 6. Open questions

- **Geocoding:** bundled city database (for example GeoNames) or an external geocoder (Nominatim); timezone from coordinates (`timezonefinder`).
- **Ephemeris:** Skyfield or pyswisseph (higher precision, but AGPL or a commercial licence).
- **Curated sources:** the initial list; English only at first?
- **LLM privacy:** how much life context is sent to the LLM provider (consent toggle?).
- **Hosting:** the Python hosting target.

## 7. Non-goals (for now)

- Full natal chart wheels and aspect grids
- Direct calendar sync (OAuth)
- Push notifications
- Community source submissions
