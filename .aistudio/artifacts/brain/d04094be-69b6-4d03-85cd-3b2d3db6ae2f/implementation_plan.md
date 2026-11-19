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
| Default sources | Curated list first (read directly, not searched), falling back to open web search |
| Curated list | Written in the Stars by Rux (YouTube), Cafe Astrology, Astrology Zone, Astrostyle, Sally Kirkman; English only |
| Personalisation | Chosen at onboarding. Personalised: life context goes to the LLM; name and birth data never do. General: only a sign is asked |
| YouTube | Channel RSS feed + per-sign timestamps + unofficial transcript download (`youtube-transcript-api`) |
| User sources | Exclusive: if the user added sources, only those are used |
| Energy charts | Hidden for now (they run on fake data); rebuilt later on real transits |
| Categories | 10 house-based life areas, replacing both earlier lists (done) |
| Forecast storage | On the device: the latest forecast per month, as versioned records |
| Month review (future) | On the device only, with an export / import file; no database before accounts |

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
1. The user has active sources: **exclusive** mode. Pages and YouTube channels are read directly; a bare site is searched with Tavily `include_domains`.
2. Otherwise: read the curated sources directly (each reader checks month and year and cuts out the sign). If fewer than two have something, fall back to open web search.
3. Exclusive mode with no usable evidence: show an evidence-gap message with a one-click "also use default sources" retry. The search is never broadened silently.

Every event cites at least one retrieved URL, and its date and wording are confirmed against that source's text in code before it is shown. Per-source agreement is shown in the event detail.

### F3. Life areas

One taxonomy, used for profile focus, LLM tagging, map rows, filters and calendar export. It replaced both `ActivityCategory` and `LifePriority`.

| Life area | Id | Houses | Examples of "good time to…" and cautions |
|---|---|---|---|
| Career & Work | `career` | 10, 6 | apply for jobs, pitch, ask for a raise, start a project |
| Money & Resources | `money` | 2, 8 | big purchases, investing, budgeting; caution on impulse spending |
| Love & Relationships | `love` | 5, 7 | dates, important conversations, commitments |
| Family & Home | `family` | 4 (+5 for kids) | family time, moving, home projects, parenting focus |
| Health & Wellbeing | `health` | 6, 1 | start a routine, check-ups, recovery |
| Friends & Community | `community` | 11 | networking, events, asking for help |
| Communication & Contracts | `communication` | 3 (+ Mercury) | signing, negotiating, key emails; Mercury retrograde cautions |
| Learning & Travel | `learning` | 9 | courses, exams, trips |
| Creativity & Fun | `creativity` | 5 | hobbies, creative launches, play |
| Rest & Inner Life | `rest` | 12, 8 | rest windows, reflection, letting go |

**Event types**
- Key date (`keyDate`)
- Good time to… (`goodTime`)
- Be careful (`caution`)
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

### F4b. Month review (later)

After the month, the user looks back: a short questionnaire or reflection on what really took place, per event ("happened / didn't") and overall.

- Reviews refer to events by their id (assigned by the server since Phase 3a). An id is built from the source, the dates and the quote of the extracted event, so it survives regeneration while the extraction is cached; it changes when the source text is extracted again with a different quote. The feature has to decide what happens to a review then.
- Stored on the device only, inside the month's forecast record (the record is versioned for this). A month with a review is never pruned.
- Needs an "export my data" / "import" file: a forecast can be regenerated, a review cannot. The same file is the migration path into a database once accounts exist.
- A review goes to the AI service only with the same kind of consent as the life context.

### F5. Real sky layer (later)

The server computes the month's sky events with Skyfield: new and full moons, sign ingresses, retrograde stations, void-of-course Moon.

Uses:
- cross-check the dates of the extracted events (their `planets` and `aspect` are kept for this)
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
- TypeScript types generated from the backend models: a JSON Schema export plus `json-schema-to-typescript` (`openapi-typescript` needs TypeScript 5; the repo is on 7).

**Backend**
- Python 3.12+, FastAPI + Uvicorn, Pydantic v2 models.
- httpx (async) for Nebius and Tavily.
- SSE via `sse-starlette`, with the same `progress` / `result` / `error` events as today.
- Skyfield for the ephemeris.
- ICS generation: a port of `ics.ts`, or the `icalendar` library.
- Tests: pytest + respx. Tooling: uv, ruff, mypy or pyright.

**Forecast pipeline** (as built)
1. Validate the profile (including life context) and the source configuration; save the profile snapshot without the life context.
2. Read the sources using the F2 rules. Only in the web-search fallback: a query agent writes one search query (sign, month and year, focus areas; no personal data) for Tavily.
3. Extractor: one LLM call per source document, with the month, the sign and that document. Nothing about the user, so the answer is cached. It returns dated events, each with a verbatim quote, the source's tone, life areas and, when the source says so, planets, aspect, house and sign.
4. Verification in code, per event: the quote is in the document and names the day; the dates lie within the month. A failed check drops that event and is counted per source.
5. Priorities in code: the house table, life context → life areas and houses, ranking (hand-picked focus areas, then derived ones, then the rest; never a filter) and a templated narrative that says only what the user stated.
6. Synthesizer: one LLM call with the verified events (no source text), the narrative and the user's dated plans. It refers to events by id and writes the theme and, per event, a title, a summary and a personal note. It can group events from several sources.
7. Assembly in code: ids must exist and are used once; of a group, the members that have the same dates are merged; dates, type, life areas, house and citations come from the extracted events; events the Synthesizer left out are still shown.
8. Deterministic `.ics`.

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
- **ForecastEvent**: `id`, `date`, `endDate?`, `title`, `type`, `lifeAreas[]`, `summary`, `personalNote?`, `sourceUrls[]`, `inFocus`, `planets?`, `aspect?`, `house?` (as built in Phase 3a)
- **MonthlyForecast**: `theme`, `events[]`, `icsContent` now; `keyDates[]` and `evidenceNote` come with the month overview (3b)
- **Stored forecast record** (device): `version`, `month`, `forecast` (`result`, `generatedAt`, `sign`, `mode`, `focusAreas`, source report, evidence); a `review` is added later

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

Notes from the port: validation was hand-written (a 1:1 port of the TypeScript checks) until Phase 3a moved it to Pydantic models, and SSE uses Starlette's `StreamingResponse` instead of `sse-starlette`.

### Phase 1: Profile and real chart
- Birth-place search and geocoding (done: bundled GeoNames city list, `GET /api/places`).
- `/api/chart` with Skyfield (done; manual sign overrides are kept and marked in the UI).
- Life-context form (done in Phase 2; in personalised mode it reaches the Synthesizer as priorities).
- Onboarding flow (done in Phase 2: personalised or general).

### Phase 2: Sources (done)
- Curated list, read directly; YouTube monthly video by transcript.
- User sources (exclusive mode): pages, sites, YouTube channels.
- Fallback to web search, and the evidence-gap retry.
- Onboarding with personalised / general mode; life context used for the forecast.

### Phase 3: Life areas and monthly output

**3a: taxonomy and data model (done)**
- The 10 life areas and 3 event types end to end: Pydantic models for every request, answer and response, prompts, TypeScript types generated from the models (`npm run gen:types`).
- Personal notes (only when a life context was sent), stable server-assigned event ids.
- The latest forecast per month kept on the device.
- Two-step forecast: a per-source Extractor whose events are verified against the source text in code, priorities and ranking in code, and a Synthesizer that refers to events by id (done).
- Open: the two-step pipeline has not been judged on a real run yet.

**3b: views**
- Month overview (theme, top key dates, evidence note), calendar grid, "Good time to…" list, event detail.

**3c: export**
- Per-event and filtered `.ics`, optional reminder.

**Later, not scheduled:** month review (F4b).

### Phase 4: Real sky layer
- Sky events, cross-checking, rebuilt energy charts.

### Phase 5: Accounts and deployment
- Auth, database, configurable hosting.

---

## 6. Open questions

- **Geocoding:** decided: bundled GeoNames city database (timezone included). Open: local-language city names and places under 15,000 people.
- **Ephemeris:** decided: Skyfield with JPL DE421 (birth years 1900 to 2050).
- **Curated sources:** decided: five English sources (see the decisions table). Open: more sources, other languages.
- **LLM privacy:** decided: the onboarding choice is the consent; life context only, never name or birth data. Open: the server still stores the birth profile snapshot.
- **Source access at scale:** transcript download from cloud hosts, crawl delays, copyright of source excerpts sent to the LLM.
- **Hosting:** the Python hosting target.

## 7. Non-goals (for now)

- Full natal chart wheels and aspect grids
- Direct calendar sync (OAuth)
- Push notifications
- Community source submissions
