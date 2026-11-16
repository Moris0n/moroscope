import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { QUERY_AGENT_PROMPT, FORECAST_AGENT_PROMPT } from './src/utils/agentPrompts.js';
import {
  MAX_EXCERPT_LENGTH,
  MAX_RESULTS,
  MAX_RESULT_CONTENT_LENGTH,
  StoredProfile,
  isHttpUrl,
  isUuid,
  parseLlmJson,
  parseMonthRange,
  sanitizeProfile,
  validateAgentQuery,
  validateForecastPayload,
  validateUserProfile,
} from './src/utils/forecastShared.js';
import { buildIcsCalendar } from './src/utils/ics.js';
import { ForecastResult, UserProfile } from './src/types/astrology.js';

dotenv.config();

const PIPELINE_TIMEOUT_MS = 180_000;
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export class PipelineError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface AgentConfig {
  nebiusApiKey: string;
  nebiusBaseUrl: string;
  nebiusModel: string;
  tavilyApiKey: string;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const nebiusApiKey = env.NEBIUS_API_KEY?.trim();
  const nebiusBaseUrlRaw = env.NEBIUS_BASE_URL?.trim();
  const nebiusModel = env.NEBIUS_MODEL?.trim();
  const tavilyApiKey = env.TAVILY_API_KEY?.trim();

  const missing: string[] = [];
  if (!nebiusApiKey) missing.push('NEBIUS_API_KEY');
  if (!nebiusBaseUrlRaw) missing.push('NEBIUS_BASE_URL');
  if (!nebiusModel) missing.push('NEBIUS_MODEL');
  if (!tavilyApiKey) missing.push('TAVILY_API_KEY');
  if (missing.length > 0) {
    throw new PipelineError(
      503,
      `Forecast backend is not configured (missing: ${missing.join(', ')}).`
    );
  }

  const baseUrl = nebiusBaseUrlRaw!.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new PipelineError(503, 'NEBIUS_BASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new PipelineError(503, 'NEBIUS_BASE_URL must be an http(s) URL.');
  }
  if (parsed.username || parsed.password) {
    throw new PipelineError(503, 'NEBIUS_BASE_URL must not contain credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new PipelineError(503, 'NEBIUS_BASE_URL must not contain a query or fragment.');
  }

  return {
    nebiusApiKey: nebiusApiKey!,
    nebiusBaseUrl: baseUrl,
    nebiusModel: nebiusModel!,
    tavilyApiKey: tavilyApiKey!,
  };
}

export interface PipelineDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  dataDir: string;
  port?: number | (() => number);
}

interface TavilyResult {
  url: string;
  title: string;
  content: string;
}

function toUpstreamError(err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  const name = (err as { name?: string })?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new PipelineError(504, 'Upstream request timed out.');
  }
  return new PipelineError(502, 'Upstream request failed.');
}

async function callNebiusChat(
  config: AgentConfig,
  deps: PipelineDeps,
  signal: AbortSignal,
  systemPrompt: string,
  userPayload: unknown
): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetchImpl(`${config.nebiusBaseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.nebiusApiKey}`,
      },
      body: JSON.stringify({
        model: config.nebiusModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    throw toUpstreamError(err);
  }
  if (!response.ok) {
    throw new PipelineError(
      502,
      `Nebius chat request failed (HTTP ${response.status}).`
    );
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new PipelineError(502, 'Nebius returned a non-JSON response.');
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new PipelineError(502, 'Nebius returned an empty completion.');
  }
  try {
    return parseLlmJson(content);
  } catch {
    throw new PipelineError(502, 'Nebius returned malformed JSON.');
  }
}

async function runTavilySearch(
  config: AgentConfig,
  deps: PipelineDeps,
  signal: AbortSignal,
  query: string
): Promise<TavilyResult[]> {
  let response: Response;
  try {
    response = await deps.fetchImpl(TAVILY_SEARCH_URL, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.tavilyApiKey,
        query,
        search_depth: 'advanced',
        max_results: 10,
        include_answer: false,
        include_raw_content: false,
      }),
    });
  } catch (err) {
    throw toUpstreamError(err);
  }
  if (!response.ok) {
    throw new PipelineError(
      502,
      `Tavily search failed (HTTP ${response.status}).`
    );
  }
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new PipelineError(502, 'Tavily returned a non-JSON response.');
  }
  const raw = Array.isArray(body?.results) ? body.results : [];
  return raw
    .slice(0, MAX_RESULTS)
    .map((r: any) => ({
      url: typeof r?.url === 'string' ? r.url : '',
      title: typeof r?.title === 'string' ? r.title.slice(0, 300) : '',
      content: typeof r?.content === 'string'
        ? r.content.slice(0, MAX_RESULT_CONTENT_LENGTH)
        : '',
    }))
    .filter((r: TavilyResult) => isHttpUrl(r.url));
}

export interface SavedProfile {
  profileId: string;
  snapshot: StoredProfile;
}

async function saveProfileSnapshot(
  deps: PipelineDeps,
  profile: UserProfile,
  profileId: string | undefined
): Promise<SavedProfile> {
  const id = profileId ?? crypto.randomUUID();
  if (!isUuid(id)) {
    throw new PipelineError(400, 'profileId must be a valid UUID.');
  }
  const dir = path.join(deps.dataDir, 'profiles');
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${id}.json`);
  if (path.dirname(target) !== dir) {
    throw new PipelineError(400, 'Invalid profileId.');
  }
  const stored = sanitizeProfile(profile);
  const tmp = path.join(dir, `.${id}.${crypto.randomUUID()}.tmp`);
  let snapshot: StoredProfile;
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(stored, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    const readBack = JSON.parse(await fs.promises.readFile(tmp, 'utf-8'));
    const check = validateUserProfile(readBack);
    if (!check.ok) {
      throw new PipelineError(500, 'Profile snapshot failed validation.');
    }
    snapshot = sanitizeProfile(readBack);
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
  try {
    await fs.promises.chmod(target, 0o600);
  } catch {}
  return { profileId: id, snapshot };
}

export interface PipelineOutput {
  result: ForecastResult;
  profileId: string;
}

export async function runForecastPipeline(
  profile: UserProfile,
  customExcerpt: string | undefined,
  deps: PipelineDeps,
  signal: AbortSignal,
  onStep: (step: number) => void,
  profileId?: string
): Promise<PipelineOutput> {
  const { profileId: savedId, snapshot } = await saveProfileSnapshot(
    deps,
    profile,
    profileId
  );
  onStep(1);

  const range = parseMonthRange(snapshot.targetMonth);
  if (!range) {
    throw new PipelineError(400, 'targetMonth must be in "Month YYYY" format.');
  }
  const month = { firstDate: range.firstDate, lastDate: range.lastDate };

  const config = loadAgentConfig(deps.env);

  const queryPayload = { profile: snapshot, month };
  const queryOutput = await callNebiusChat(
    config,
    deps,
    signal,
    QUERY_AGENT_PROMPT,
    queryPayload
  );
  const query = validateAgentQuery(queryOutput);
  if (!query) {
    throw new PipelineError(
      502,
      'Query agent returned an invalid search query.'
    );
  }

  onStep(2);
  const results = await runTavilySearch(config, deps, signal, query);

  onStep(3);
  const excerpt =
    typeof customExcerpt === 'string' && customExcerpt.trim().length > 0
      ? customExcerpt.slice(0, MAX_EXCERPT_LENGTH)
      : undefined;
  const forecastPayload = {
    profile: snapshot,
    month,
    query,
    results,
    ...(excerpt ? { customExcerpt: excerpt } : {}),
  };
  const forecastOutput = await callNebiusChat(
    config,
    deps,
    signal,
    FORECAST_AGENT_PROMPT,
    forecastPayload
  );
  const allowedUrls = new Set(results.map((r) => r.url));
  const validated = validateForecastPayload(
    forecastOutput,
    range,
    snapshot.priorities,
    allowedUrls
  );
  if (!validated.ok || !validated.result) {
    throw new PipelineError(
      502,
      `Forecast agent returned invalid data: ${validated.errors[0] || 'schema violation'}.`
    );
  }

  onStep(4);
  const ics = buildIcsCalendar(
    validated.result.events,
    `${range.year}-${String(range.month).padStart(2, '0')}`
  );

  return {
    result: {
      overall_theme: validated.result.overall_theme,
      events: validated.result.events,
      ics_content: ics,
    },
    profileId: savedId,
  };
}

function wantsSse(req: express.Request): boolean {
  const accept = req.headers.accept || '';
  return accept.includes('text/event-stream');
}

function writeSse(
  res: express.Response,
  event: string,
  data: unknown
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function resolvePort(deps: PipelineDeps): number {
  const p = deps.port;
  if (typeof p === 'function') return p() || 3000;
  return p || 3000;
}

function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  const hostname = normalized.startsWith('[')
    ? normalized.slice(0, normalized.indexOf(']') + 1)
    : normalized.split(':')[0];
  if (!LOCAL_HOSTNAMES.has(hostname)) return false;
  const portPart = normalized.startsWith('[')
    ? normalized.slice(normalized.indexOf(']') + 1).replace(/^:/, '')
    : normalized.split(':').slice(1).join(':');
  if (portPart && Number(portPart) !== port) return false;
  return true;
}

export function createApp(deps: PipelineDeps): express.Express {
  const app = express();

  app.use((req, res, next) => {
    const port = resolvePort(deps);
    if (!isAllowedHost(req.headers.host, port)) {
      res.status(403).json({ error: 'Forbidden host.' });
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin);
        if (o.host.toLowerCase() !== (req.headers.host || '').toLowerCase()) {
          res.status(403).json({ error: 'Forbidden origin.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Forbidden origin.' });
        return;
      }
    }
    next();
  });

  app.use(express.json({ limit: '2mb' }));

  app.post('/api/profiles', async (req, res) => {
    try {
      const { profile, profileId } = req.body ?? {};
      const check = validateUserProfile(profile);
      if (!check.ok) {
        res.status(400).json({ error: check.errors.join('; ') });
        return;
      }
      if (profileId !== undefined && !isUuid(profileId)) {
        res.status(400).json({ error: 'profileId must be a valid UUID.' });
        return;
      }
      const { profileId: id } = await saveProfileSnapshot(deps, profile, profileId);
      res.json({ profileId: id });
    } catch (err) {
      const status = err instanceof PipelineError ? err.status : 500;
      res.status(status).json({
        error:
          err instanceof PipelineError
            ? err.message
            : 'Failed to save profile.',
      });
    }
  });

  // Server-side Horoscope Multi-Source Synthesis & Timezone Normalization Endpoint
  app.post('/api/horoscope/synthesize', async (req, res) => {
    const { profile, profileId, customExcerpt } = req.body ?? {};
    const check = validateUserProfile(profile);
    if (!check.ok) {
      res.status(400).json({ error: check.errors.join('; ') });
      return;
    }
    if (profileId !== undefined && !isUuid(profileId)) {
      res.status(400).json({ error: 'profileId must be a valid UUID.' });
      return;
    }
    if (
      customExcerpt !== undefined &&
      (typeof customExcerpt !== 'string' ||
        customExcerpt.length > MAX_EXCERPT_LENGTH)
    ) {
      res.status(400).json({ error: 'customExcerpt must be a bounded string.' });
      return;
    }

    const sse = wantsSse(req);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, PIPELINE_TIMEOUT_MS);
    const onResClose = () => {
      if (!res.writableEnded) abort();
    };
    const onReqAborted = () => abort();
    res.on('close', onResClose);
    req.on('aborted', onReqAborted);

    if (sse) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
    }

    const onStep = (step: number) => {
      if (sse && !res.writableEnded) writeSse(res, 'progress', { step });
    };

    try {
      const output = await runForecastPipeline(
        profile,
        customExcerpt,
        deps,
        controller.signal,
        onStep,
        profileId
      );
      if (sse) {
        if (!res.writableEnded) {
          writeSse(res, 'result', {
            result: output.result,
            profileId: output.profileId,
          });
          res.end();
        }
      } else {
        res.json({
          result: output.result,
          profileId: output.profileId,
        });
      }
    } catch (err) {
      const isAbort =
        (err as { name?: string })?.name === 'AbortError' ||
        controller.signal.aborted;
      const status =
        err instanceof PipelineError ? err.status : isAbort ? 504 : 500;
      const message =
        err instanceof PipelineError
          ? err.message
          : isAbort
          ? 'Forecast pipeline timed out or the client disconnected.'
          : 'Forecast pipeline failed.';
      if (sse) {
        if (!res.writableEnded) {
          writeSse(res, 'error', { error: message });
          res.end();
        }
      } else if (!res.headersSent) {
        res.status(status).json({ error: message });
      }
    } finally {
      clearTimeout(timeout);
      res.off('close', onResClose);
      req.off('aborted', onReqAborted);
    }
  });

  return app;
}

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const app = createApp({
    env: process.env,
    fetchImpl: fetch,
    dataDir: path.join(process.cwd(), 'data'),
    port: PORT,
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
        fs: {
          deny: [
            '.env',
            '.env.*',
            '*.{crt,pem}',
            '**/.git/**',
            '**/data/**',
          ],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`CelestialPulse server listening on http://localhost:${PORT}`);
  });
}

const invokedAsMain =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsMain) {
  startServer();
}
