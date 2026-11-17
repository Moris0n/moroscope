# Moroscope

Personal monthly astrology planner. It takes a birth profile, searches published astrology
sources, and produces a source-cited monthly forecast (key dates, opportunities, cautions)
that can be downloaded as an `.ics` calendar.

- Product plan and roadmap: [implementation_plan.md](.aistudio/artifacts/brain/d04094be-69b6-4d03-85cd-3b2d3db6ae2f/implementation_plan.md)
- Current state of the code: [project.md](project.md)

## Run locally

**Prerequisites:** Node.js, [uv](https://docs.astral.sh/uv/) (it installs Python 3.12+ if needed).

1. Install dependencies:
   ```
   npm install
   cd backend && uv sync
   ```
2. Copy [.env.example](.env.example) to `.env` and set `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`,
   `NEBIUS_MODEL` and `TAVILY_API_KEY` (required to generate forecasts).
3. Start the API and the frontend in two terminals:
   ```
   npm run dev:api    # FastAPI on http://127.0.0.1:8000
   npm run dev        # Vite on http://localhost:3000, proxies /api to the API
   ```

Open `http://localhost:3000`. Saved profiles are written to `data/profiles/`.

## Checks

| Task | Command |
|------|---------|
| Frontend typecheck | `npm run lint` |
| Frontend tests | `npm test` |
| Backend tests | `npm run test:api` |
| Backend lint / format | `cd backend && uv run ruff check . && uv run ruff format --check .` |
| Frontend build | `npm run build` |

## Production

Build the frontend, then let the backend serve it as a single service:

```
npm run build
cd backend && APP_ENV=production uv run python -m app
```

To serve on anything other than localhost, set `HOST` and `ALLOWED_HOSTS` (see `.env.example`).
