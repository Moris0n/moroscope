

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/6728bd81-10b6-4b6f-b8a1-7ea8adf781cd

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy [.env.example](.env.example) to `.env` and set `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, and `TAVILY_API_KEY` (required for the forecast pipeline)
3. Run the app:
   `npm run dev`

The app is served at `http://localhost:3000` (bound to 127.0.0.1). Profiles are persisted under `data/profiles/`.
