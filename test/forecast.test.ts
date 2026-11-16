import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import http from 'node:http';

import {
  DEFAULT_TARGET_MONTH,
  inclusiveDaySpan,
  isValidBackendUrl,
  isValidForecastShape,
  mergeProfileWithDefaults,
  parseLlmJson,
  parseMonthRange,
  sanitizeProfile,
  validateForecastPayload,
  validateUserProfile,
} from '../src/utils/forecastShared.ts';
import { buildIcsCalendar, foldIcsLine } from '../src/utils/ics.ts';
import {
  SseParser,
  buildMonthlyHeatmap,
  readForecastSseStream,
} from '../src/utils/forecastHelpers.ts';
import {
  PipelineDeps,
  PipelineError,
  createApp,
  loadAgentConfig,
  runForecastPipeline,
} from '../server.ts';
import {
  FORECAST_AGENT_PROMPT,
  QUERY_AGENT_PROMPT,
} from '../src/utils/agentPrompts.ts';
import { TransitEvent, UserProfile } from '../src/types/astrology.ts';

const FULL_ENV = {
  NEBIUS_API_KEY: 'test-nebius-key',
  NEBIUS_BASE_URL: 'https://nebius.test/v1/',
  NEBIUS_MODEL: 'test-model',
  TAVILY_API_KEY: 'test-tavily-key',
} as unknown as NodeJS.ProcessEnv;

const VALID_PROFILE: UserProfile = {
  name: 'Test User',
  birthDate: '1994-10-17',
  birthTime: '08:45',
  hasExactTime: true,
  birthLocation: 'New York, NY',
  birthTimezone: 'America/New_York',
  operatingTimezone: 'America/New_York',
  sunSign: 'Libra',
  moonSign: 'Taurus',
  risingSign: 'Scorpio',
  useRisingPrimary: true,
  activeCategories: ['career', 'finance'],
  targetMonth: 'November 2026',
  priorities: ['careerTransition', 'financialPlanning'],
  backendUrl: '',
};

const TAVILY_RESULTS = [
  { url: 'https://astro.example/nov-2026', title: 'Nov forecast', content: 'Mars ingress on Nov 5' },
  { url: 'https://sky.example/scorpio', title: 'Scorpio rising', content: 'Venus transit Nov 12-14' },
];

function validEvent(overrides: Partial<TransitEvent> = {}): TransitEvent {
  return {
    date: '2026-11-05',
    title: 'Mars ingress window',
    impact_type: 'Opportunity',
    summary: 'A sourced transit event.',
    topics: ['careerTransition'],
    source_urls: ['https://astro.example/nov-2026'],
    ...overrides,
  };
}

function validForecastPayload(overrides: any = {}) {
  return {
    overall_theme: 'A month of sourced transitions.',
    events: [validEvent()],
    ...overrides,
  };
}

function tmpDeps(fetchImpl?: typeof fetch): { deps: PipelineDeps; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-profiles-'));
  return {
    dir,
    deps: {
      env: FULL_ENV,
      fetchImpl: fetchImpl || (async () => new Response('{}')),
      dataDir: dir,
      port: 3000,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function nebiusResponse(content: unknown): Response {
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

function scriptedFetch(calls: { url: string; body: any }[], opts: any = {}) {
  const nebiusOutputs = opts.nebiusOutputs || [
    { query: 'scorpio rising november 2026 horoscope dates' },
    validForecastPayload(),
  ];
  let nebiusIdx = 0;
  const impl: typeof fetch = async (input: any, init: any) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes('api.tavily.com')) {
      if (opts.tavilyError) throw opts.tavilyError;
      return jsonResponse({ results: opts.tavilyResults ?? TAVILY_RESULTS });
    }
    if (opts.nebiusError) throw opts.nebiusError;
    if (opts.nebiusStatus) return new Response('err', { status: opts.nebiusStatus });
    const out = nebiusOutputs[Math.min(nebiusIdx++, nebiusOutputs.length - 1)];
    return nebiusResponse(out);
  };
  return impl;
}

function delayedAbortAwareFetch(
  calls: { url: string; body: any }[],
  delayMs = 15,
  opts: any = {}
) {
  let nebiusIdx = 0;
  const impl: typeof fetch = (input: any, init: any) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      const signal: AbortSignal | undefined = init?.signal;
      const abortNow = () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (signal?.aborted) {
        calls.push({ url: `${url}#aborted-before-start`, body: null });
        abortNow();
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abortNow);
        if (url.includes('api.tavily.com')) {
          resolve(jsonResponse({ results: TAVILY_RESULTS }));
        } else {
          const outs = opts.nebiusOutputs || [
            { query: 'q' },
            validForecastPayload(),
          ];
          resolve(nebiusResponse(outs[Math.min(nebiusIdx++, outs.length - 1)]));
        }
      }, delayMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        abortNow();
      });
    });
  return impl;
}

async function withServer(
  deps: PipelineDeps,
  fn: (base: string, port: number) => Promise<void>
): Promise<void> {
  const app = createApp(deps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  deps.port = port;
  try {
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    server.close();
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('parseMonthRange accepts strict "Month YYYY" and computes UTC bounds', () => {
  const nov = parseMonthRange('November 2026');
  assert.ok(nov);
  assert.equal(nov.firstDate, '2026-11-01');
  assert.equal(nov.lastDate, '2026-11-30');
  assert.equal(nov.daysInMonth, 30);

  const feb = parseMonthRange('February 2028');
  assert.equal(feb!.daysInMonth, 29);
  assert.equal(feb!.lastDate, '2028-02-29');
  const febCommon = parseMonthRange('February 2027');
  assert.equal(febCommon!.daysInMonth, 28);
});

test('parseMonthRange rejects non-English/partial/malformed input', () => {
  for (const bad of [
    'Nov 2026',
    '2026-11',
    'November 26',
    'november 2026',
    'November  2026 extra',
    'Smarch 2026',
    '',
    202611,
    null,
  ]) {
    assert.equal(parseMonthRange(bad), null, String(bad));
  }
});

test('validateUserProfile enforces the full required schema', () => {
  assert.equal(validateUserProfile(VALID_PROFILE).ok, true);
  assert.equal(validateUserProfile(null).ok, false);
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, targetMonth: 'Nov 2026' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, priorities: ['bogus'] }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, birthDate: '1994-02-30' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, name: '' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, sunSign: 'NotASign' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, moonSign: undefined }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, birthTime: '25:99' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({
      ...VALID_PROFILE,
      hasExactTime: false,
      birthTime: '',
    }).ok,
    true
  );
  assert.equal(
    validateUserProfile({
      ...VALID_PROFILE,
      hasExactTime: false,
      birthTime: '8:45',
    }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, operatingTimezone: 'Mars/Olympus' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, activeCategories: [] }).ok,
    false
  );
  assert.equal(
    validateUserProfile({
      ...VALID_PROFILE,
      activeCategories: ['career', 'madeUp'],
    }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, hasExactTime: 'yes' }).ok,
    false
  );
  assert.equal(
    validateUserProfile({ ...VALID_PROFILE, backendUrl: 'https://x/y?key=1' }).ok,
    false
  );
});

test('sanitizeProfile allowlists fields and drops backendUrl', () => {
  const out = sanitizeProfile({
    ...VALID_PROFILE,
    backendUrl: 'https://evil.example',
    admin: true,
    nested: { bad: 1 },
  });
  assert.equal('backendUrl' in out, false);
  assert.equal('admin' in out, false);
  assert.equal('nested' in out, false);
  assert.equal(out.name, 'Test User');
  assert.equal(out.targetMonth, 'November 2026');
});

test('isValidBackendUrl accepts only plain http(s) origins or empty', () => {
  assert.equal(isValidBackendUrl(''), true);
  assert.equal(isValidBackendUrl('https://api.example.com'), true);
  assert.equal(isValidBackendUrl('http://localhost:8080'), true);
  assert.equal(isValidBackendUrl('https://user:pw@api.example.com'), false);
  assert.equal(isValidBackendUrl('https://api.example.com?x=1'), false);
  assert.equal(isValidBackendUrl('https://api.example.com#f'), false);
  assert.equal(isValidBackendUrl('ftp://x'), false);
  assert.equal(isValidBackendUrl('not a url'), false);
});

test('mergeProfileWithDefaults repairs corrupt legacy values', () => {
  const legacy = { name: 'Old User', birthDate: '1990-01-15' };
  const merged = mergeProfileWithDefaults(VALID_PROFILE, legacy);
  assert.equal(merged.targetMonth, DEFAULT_TARGET_MONTH);
  assert.deepEqual(merged.priorities, VALID_PROFILE.priorities);
  assert.equal(merged.backendUrl, '');
  assert.equal(merged.name, 'Old User');

  const corrupt = mergeProfileWithDefaults(VALID_PROFILE, {
    targetMonth: 'garbage',
    priorities: 'nope',
    sunSign: 'X',
    moonSign: 5,
    operatingTimezone: 'Mars/Olympus',
    activeCategories: ['bogus'],
    backendUrl: 'https://u:p@h/x?y=1',
    birthTime: '99:99',
  });
  assert.equal(corrupt.targetMonth, DEFAULT_TARGET_MONTH);
  assert.equal(corrupt.sunSign, VALID_PROFILE.sunSign);
  assert.equal(corrupt.moonSign, VALID_PROFILE.moonSign);
  assert.equal(corrupt.operatingTimezone, VALID_PROFILE.operatingTimezone);
  assert.deepEqual(corrupt.activeCategories, VALID_PROFILE.activeCategories);
  assert.equal(corrupt.backendUrl, '');
  assert.equal(corrupt.birthTime, VALID_PROFILE.birthTime);
  assert.equal(validateUserProfile(corrupt).ok, true);
});

test('validateForecastPayload rejects wrong year, bad dates, bad topics/URLs', () => {
  const range = parseMonthRange('November 2026')!;
  const urls = new Set(TAVILY_RESULTS.map((r) => r.url));

  assert.equal(
    validateForecastPayload(
      validForecastPayload({ events: [validEvent({ date: '2025-11-05' })] }),
      range, VALID_PROFILE.priorities, urls
    ).ok, false
  );
  assert.equal(
    validateForecastPayload(
      validForecastPayload({ events: [validEvent({ date: '2026-11-31' })] }),
      range, VALID_PROFILE.priorities, urls
    ).ok, false
  );
  assert.equal(
    validateForecastPayload(
      validForecastPayload({
        events: [validEvent({ date: '2026-11-10', end_date: '2026-11-09' })],
      }),
      range, VALID_PROFILE.priorities, urls
    ).ok, false
  );
  assert.equal(
    validateForecastPayload(
      validForecastPayload({ events: [validEvent({ topics: ['lottery' as any] })] }),
      range, VALID_PROFILE.priorities, urls
    ).ok, false
  );
  assert.equal(
    validateForecastPayload(
      validForecastPayload({ events: [validEvent({ topics: ['datingRomance'] })] }),
      range, VALID_PROFILE.priorities, urls
    ).ok, false
  );
  assert.equal(
    validateForecastPayload(
      validForecastPayload({
        events: [validEvent({ source_urls: ['https://fabricated.example/x'] })],
      }),
      range, VALID_PROFILE.priorities, urls
    ).ok, false
  );
  assert.equal(
    validateForecastPayload(
      validForecastPayload(), range, VALID_PROFILE.priorities, urls
    ).ok, true
  );
});

test('isValidForecastShape guards the client against malformed results', () => {
  assert.equal(
    isValidForecastShape({ overall_theme: 't', events: [], ics_content: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }),
    true
  );
  assert.equal(
    isValidForecastShape({ overall_theme: 't', events: [validEvent()], ics_content: 'BEGIN:VCALENDAR x' }),
    true
  );
  assert.equal(isValidForecastShape({ events: [] }), false);
  assert.equal(isValidForecastShape('{"a":1}'), false);
  assert.equal(
    isValidForecastShape({
      overall_theme: 't',
      ics_content: 'BEGIN:VCALENDAR',
      events: [{ date: 'not-a-date' }],
    }),
    false
  );
});

test('parseLlmJson accepts fenced JSON but never repairs content', () => {
  assert.deepEqual(parseLlmJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLlmJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseLlmJson('{"a":'));
});

test('ICS builder escapes text, folds long lines, rolls year boundary', () => {
  const ev: TransitEvent = {
    date: '2026-12-30',
    end_date: '2026-12-31',
    title: 'Comma, semicolon; and \\backslash',
    impact_type: 'Caution',
    summary: 'Line one\nLine two — ' + 'é'.repeat(120),
    topics: ['healthHabits'],
    source_urls: ['https://x.example/a,b'],
  };
  const ics = buildIcsCalendar([ev], '2026-12', new Date('2026-10-18T12:00:00Z'));

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261230/);
  assert.match(ics, /DTEND;VALUE=DATE:20270101/);
  assert.match(ics, /SUMMARY:\[Caution\] Comma\\, semicolon\\; and \\\\backslash/);
  assert.match(ics, /Line one\\nLine two/);
  assert.match(ics, /DTSTAMP:20261018T120000Z/);
  assert.ok(ics.endsWith('\r\n'));

  for (const line of ics.split('\r\n')) {
    assert.ok(
      new TextEncoder().encode(line).length <= 75,
      `line too long: ${line.slice(0, 40)}`
    );
  }
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('é'.repeat(120)));
});

test('ICS Feb leap-year exclusive end and empty events', () => {
  const ev: TransitEvent = {
    date: '2028-02-28',
    end_date: '2028-02-29',
    title: 'Leap day event',
    impact_type: 'Milestone',
    summary: 'Covers leap day.',
    topics: ['financialPlanning'],
    source_urls: ['https://x.example/'],
  };
  const ics = buildIcsCalendar([ev], '2028-02', new Date());
  assert.match(ics, /DTSTART;VALUE=DATE:20280228/);
  assert.match(ics, /DTEND;VALUE=DATE:20280301/);

  const empty = buildIcsCalendar([], '2028-02', new Date());
  assert.match(empty, /BEGIN:VCALENDAR/);
  assert.match(empty, /END:VCALENDAR/);
  assert.ok(!empty.includes('BEGIN:VEVENT'));

  assert.ok(inclusiveDaySpan('2026-11-05', '2026-11-07').length === 3);
});

test('foldIcsLine never splits UTF-8 sequences', () => {
  const line = 'DESCRIPTION:' + '漢字'.repeat(60);
  const folded = foldIcsLine(line);
  for (const l of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(l).length <= 75);
  }
  assert.equal(folded.replace(/\r\n /g, ''), line);
});

test('POST /api/profiles saves atomically and survives missing agent keys', async () => {
  const { deps, dir } = tmpDeps();
  const noEnv = { ...deps, env: {} as NodeJS.ProcessEnv };
  await withServer(noEnv, async (base) => {
    const res = await fetch(`${base}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.match(data.profileId, UUID_RE);

    const file = path.join(dir, 'profiles', `${data.profileId}.json`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(stored.name, 'Test User');
    assert.equal('backendUrl' in stored, false);
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    const leftovers = fs.readdirSync(path.join(dir, 'profiles')).filter((f) => f.endsWith('.tmp'));
    assert.equal(leftovers.length, 0);
  });
});

test('POST /api/profiles rejects traversal/bad ids and bad profiles', async () => {
  const { deps, dir } = tmpDeps();
  await withServer(deps, async (base) => {
    for (const profileId of ['../../etc/passwd', 'not-a-uuid', '../x.json']) {
      const bad = await fetch(`${base}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: VALID_PROFILE, profileId }),
      });
      assert.equal(bad.status, 400, profileId);
    }

    const invalid = await fetch(`${base}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { targetMonth: 'x' } }),
    });
    assert.equal(invalid.status, 400);

    const files = fs.existsSync(path.join(dir, 'profiles'))
      ? fs.readdirSync(path.join(dir, 'profiles'))
      : [];
    assert.equal(files.length, 0);
  });
});

function rawPost(
  port: number,
  pathName: string,
  headers: http.OutgoingHttpHeaders,
  body: string
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathName, method: 'POST', headers },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, text }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('host allowlist and cross-origin API requests are rejected', async () => {
  const { deps } = tmpDeps();
  await withServer(deps, async (base, port) => {
    const body = JSON.stringify({ profile: VALID_PROFILE });
    const jsonHeaders = { 'Content-Type': 'application/json' };

    const evilHost = await rawPost(port, '/api/profiles', {
      ...jsonHeaders,
      Host: 'evil.example.com',
    }, body);
    assert.equal(evilHost.status, 403);

    const wrongPort = await rawPost(port, '/api/profiles', {
      ...jsonHeaders,
      Host: 'localhost:9999',
    }, body);
    assert.equal(wrongPort.status, 403);

    const crossOrigin = await rawPost(port, '/api/profiles', {
      ...jsonHeaders,
      Host: `127.0.0.1:${port}`,
      Origin: 'https://evil.example.com',
    }, body);
    assert.equal(crossOrigin.status, 403);

    const mismatchedOrigin = await rawPost(port, '/api/profiles', {
      ...jsonHeaders,
      Host: `127.0.0.1:${port}`,
      Origin: 'http://localhost:9999',
    }, body);
    assert.equal(mismatchedOrigin.status, 403);

    const sameOrigin = await rawPost(port, '/api/profiles', {
      ...jsonHeaders,
      Host: `127.0.0.1:${port}`,
      Origin: `http://127.0.0.1:${port}`,
    }, body);
    assert.equal(sameOrigin.status, 200);

    const noOrigin = await rawPost(port, '/api/profiles', {
      ...jsonHeaders,
      Host: `localhost:${port}`,
    }, body);
    assert.equal(noOrigin.status, 200);
  });
});

function promptRoutedFetch(calls: { url: string; body: any }[]) {
  const impl: typeof fetch = async (input: any, init: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes('api.tavily.com')) {
      return jsonResponse({ results: TAVILY_RESULTS });
    }
    const system = body?.messages?.[0]?.content;
    if (system === QUERY_AGENT_PROMPT) {
      return nebiusResponse({ query: 'scoped query' });
    }
    const user = body?.messages?.[1]?.content
      ? JSON.parse(body.messages[1].content)
      : {};
    const firstDate: string = user?.month?.firstDate || '2026-11-01';
    const day = firstDate.slice(0, 8) + '05';
    return nebiusResponse(
      validForecastPayload({
        events: [validEvent({ date: day, topics: user?.profile?.priorities?.length ? [user.profile.priorities[0]] : ['careerTransition'] })],
      })
    );
  };
  return impl;
}

test('concurrent same-profileId pipelines each read their own snapshot', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(promptRoutedFetch(calls));
  const sharedId = crypto.randomUUID();
  const pA = { ...VALID_PROFILE, targetMonth: 'November 2026' };
  const pB = { ...VALID_PROFILE, targetMonth: 'December 2026', priorities: ['datingRomance' as const] };

  const [outA, outB] = await Promise.all([
    runForecastPipeline(pA, undefined, deps, new AbortController().signal, () => {}, sharedId),
    runForecastPipeline(pB, undefined, deps, new AbortController().signal, () => {}, sharedId),
  ]);
  assert.equal(outA.profileId, sharedId);
  assert.equal(outB.profileId, sharedId);

  const queryPayloads = calls
    .filter(
      (c) =>
        c.url.includes('nebius') &&
        c.body?.messages?.[0]?.content === QUERY_AGENT_PROMPT
    )
    .map((c) => JSON.parse(c.body.messages[1].content));
  const months = queryPayloads.map((q) => q.month.firstDate).sort();
  assert.deepEqual(months, ['2026-11-01', '2026-12-01']);
  const usedPriorities = queryPayloads.map((q) => q.profile.priorities[0]).sort();
  assert.deepEqual(usedPriorities, ['careerTransition', 'datingRomance']);
});

test('pipeline: two Nebius calls bracket exactly one Tavily call, in order', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(scriptedFetch(calls));
  const out = await runForecastPipeline(
    VALID_PROFILE,
    undefined,
    deps,
    new AbortController().signal,
    () => {},
    undefined
  );

  const order = calls.map((c) =>
    c.url.includes('tavily') ? 'tavily' : 'nebius'
  );
  assert.deepEqual(order, ['nebius', 'tavily', 'nebius']);

  assert.equal(calls[0].url, 'https://nebius.test/v1/chat/completions');
  assert.equal(calls[0].body.model, 'test-model');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(calls[0].body.messages[0].content, QUERY_AGENT_PROMPT);
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  const qData = JSON.parse(calls[0].body.messages[1].content);
  assert.deepEqual(qData.month, {
    firstDate: '2026-11-01',
    lastDate: '2026-11-30',
  });
  assert.equal(qData.profile.sunSign, 'Libra');
  assert.equal('backendUrl' in qData.profile, false);

  const tv = calls[1].body;
  assert.equal(tv.api_key, 'test-tavily-key');
  assert.equal(tv.query, 'scorpio rising november 2026 horoscope dates');
  assert.equal(tv.search_depth, 'advanced');
  assert.equal(tv.max_results, 10);
  assert.equal(tv.include_answer, false);
  assert.equal(tv.include_raw_content, false);

  assert.equal(calls[2].body.messages[0].content, FORECAST_AGENT_PROMPT);
  const fData = JSON.parse(calls[2].body.messages[1].content);
  assert.equal(fData.query, 'scorpio rising november 2026 horoscope dates');
  assert.equal(fData.results.length, 2);
  assert.equal('backendUrl' in fData.profile, false);

  assert.equal(out.result.events.length, 1);
  assert.match(out.result.ics_content, /BEGIN:VCALENDAR/);
  assert.match(out.profileId, UUID_RE);
});

test('pipeline rejects oversized/invalid query and fabricated forecast fields', async () => {
  const calls: { url: string; body: any }[] = [];

  const { deps: d1 } = tmpDeps(
    scriptedFetch(calls, { nebiusOutputs: [{ query: 'x'.repeat(400) }] })
  );
  await assert.rejects(
    runForecastPipeline(VALID_PROFILE, undefined, d1, new AbortController().signal, () => {}),
    (e) => e instanceof PipelineError && e.status === 502
  );

  calls.length = 0;
  const { deps: d2 } = tmpDeps(
    scriptedFetch(calls, {
      nebiusOutputs: [
        { query: 'ok query' },
        validForecastPayload({
          events: [validEvent({ source_urls: ['https://fake.example/'] })],
        }),
      ],
    })
  );
  await assert.rejects(
    runForecastPipeline(VALID_PROFILE, undefined, d2, new AbortController().signal, () => {}),
    (e: any) => e instanceof PipelineError && e.status === 502
  );
});

test('pipeline handles empty Tavily evidence → honest empty result', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(
    scriptedFetch(calls, {
      tavilyResults: [],
      nebiusOutputs: [
        { query: 'q' },
        {
          overall_theme: 'No adequately dated sources found for this month.',
          events: [],
        },
      ],
    })
  );
  const out = await runForecastPipeline(
    VALID_PROFILE, undefined, deps, new AbortController().signal, () => {}
  );
  assert.equal(out.result.events.length, 0);
  assert.match(out.result.overall_theme, /No adequately dated/);
  assert.match(out.result.ics_content, /END:VCALENDAR/);
});

test('pipeline maps upstream HTTP failure to 502 and abort to 504', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps: badStatus } = tmpDeps(
    scriptedFetch(calls, { nebiusStatus: 500 })
  );
  await assert.rejects(
    runForecastPipeline(VALID_PROFILE, undefined, badStatus, new AbortController().signal, () => {}),
    (e: any) => e.status === 502
  );

  const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { deps: aborted } = tmpDeps(
    scriptedFetch(calls, { nebiusError: abortErr })
  );
  await assert.rejects(
    runForecastPipeline(VALID_PROFILE, undefined, aborted, new AbortController().signal, () => {}),
    (e: any) => e.status === 504
  );
});

test('missing config → 503, but profile is still persisted first', async () => {
  const { deps, dir } = tmpDeps();
  const noKeys = { ...deps, env: {} as NodeJS.ProcessEnv };
  await withServer(noKeys, async (base) => {
    const res = await fetch(`${base}/api/horoscope/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    });
    assert.equal(res.status, 503);
    const data = (await res.json()) as any;
    assert.match(data.error, /NEBIUS_API_KEY/);
    const files = fs.readdirSync(path.join(dir, 'profiles'));
    assert.equal(files.length, 1);
  });
  assert.throws(() => loadAgentConfig({} as NodeJS.ProcessEnv), (e: any) => e.status === 503);
  assert.throws(
    () =>
      loadAgentConfig({
        ...FULL_ENV,
        NEBIUS_BASE_URL: 'https://user:pass@host/v1',
      } as NodeJS.ProcessEnv),
    /credentials/
  );
  assert.throws(
    () =>
      loadAgentConfig({
        ...FULL_ENV,
        NEBIUS_BASE_URL: 'https://host/v1?q=1',
      } as NodeJS.ProcessEnv),
    /query or fragment/
  );
});

test('ordinary POST completes all 3 upstream calls with delayed abort-aware fetch', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(delayedAbortAwareFetch(calls, 10));
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/api/horoscope/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.equal(data.result.events.length, 1);
    const upstream = calls.filter((c) => !c.url.includes('#aborted'));
    assert.equal(upstream.length, 3);
    assert.equal(calls.filter((c) => c.url.includes('#aborted')).length, 0);
  });
});

test('early client disconnect aborts the active upstream call, no further calls', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(delayedAbortAwareFetch(calls, 250));
  await withServer(deps, async (base, port) => {
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/horoscope/synthesize',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        () => {}
      );
      req.on('error', () => {});
      req.write(JSON.stringify({ profile: VALID_PROFILE }));
      req.end();
      setTimeout(() => {
        req.destroy();
        setTimeout(resolve, 150);
      }, 80);
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(calls.length <= 1, `expected at most the query-agent call, got ${calls.length}`);
  });
});

test('JSON response path returns result + profileId', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(scriptedFetch(calls));
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/api/horoscope/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.match(data.profileId, UUID_RE);
    assert.equal(data.result.events.length, 1);
    assert.match(data.result.ics_content, /BEGIN:VCALENDAR/);
  });
});

test('SSE stream emits ordered progress steps then result', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(scriptedFetch(calls));
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/api/horoscope/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /text\/event-stream/);
    const text = await res.text();
    const events = text
      .split('\n\n')
      .filter((b) => b.startsWith('event:'))
      .map((b) => b.split('\n')[0].replace('event: ', ''));
    assert.deepEqual(events, [
      'progress',
      'progress',
      'progress',
      'progress',
      'result',
    ]);
    const steps = text
      .split('\n\n')
      .filter((b) => b.includes('event: progress'))
      .map((b) => JSON.parse(b.split('data: ')[1]).step);
    assert.deepEqual(steps, [1, 2, 3, 4]);
    const resultBlock = text
      .split('\n\n')
      .find((b) => b.includes('event: result'))!;
    const payload = JSON.parse(resultBlock.split('data: ')[1]);
    assert.equal(payload.result.events.length, 1);
    assert.match(payload.profileId, UUID_RE);
  });
});

test('SSE error event on upstream failure', async () => {
  const calls: { url: string; body: any }[] = [];
  const { deps } = tmpDeps(scriptedFetch(calls, { nebiusStatus: 503 }));
  await withServer(deps, async (base) => {
    const res = await fetch(`${base}/api/horoscope/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ profile: VALID_PROFILE }),
    });
    const text = await res.text();
    const errorBlock = text
      .split('\n\n')
      .find((b) => b.includes('event: error'))!;
    const payload = JSON.parse(errorBlock.split('data: ')[1]);
    assert.match(payload.error, /HTTP 503/);
    assert.ok(!text.includes('event: result'));
  });
});

test('buildMonthlyHeatmap maps inclusive ranges and mixed impacts', () => {
  const range = parseMonthRange('November 2026')!;
  const events: TransitEvent[] = [
    validEvent({ date: '2026-11-05', end_date: '2026-11-07' }),
    validEvent({
      date: '2026-11-06',
      impact_type: 'Caution',
      topics: ['careerTransition'],
    }),
    validEvent({ date: '2026-11-10', topics: ['financialPlanning'], impact_type: 'Milestone' }),
  ];
  const matrix = buildMonthlyHeatmap(events, range, [
    'careerTransition',
    'financialPlanning',
    'datingRomance',
  ]);
  const career = matrix[0];
  assert.equal(career[4].events.length, 1);
  assert.equal(career[5].impacts.size, 2);
  assert.ok(career[5].impacts.has('Caution'));
  assert.equal(career[6].events.length, 1);
  assert.equal(career[7].events.length, 0);
  assert.equal(matrix[1][9].impacts.has('Milestone'), true);
  assert.equal(matrix[2].every((c) => c.events.length === 0), true);
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

const SSE_DOC =
  'event: progress\r\ndata: {"step":1}\r\n\r\n' +
  'event: progress\r\ndata: {"step":2}\r\n\r\n' +
  'event: result\r\ndata: {"result":{"overall_theme":"漢字 theme ✨","events":[],"ics_content":"BEGIN:VCALENDAR\\r\\nEND:VCALENDAR"},"profileId":"abc"}\r\n\r\n';

test('SseParser survives every possible split position in a CRLF stream', async () => {
  for (let cut = 1; cut < SSE_DOC.length; cut++) {
    const steps: number[] = [];
    const out = await readForecastSseStream(
      streamOf([SSE_DOC.slice(0, cut), SSE_DOC.slice(cut)]),
      { onProgress: (s) => steps.push(s) }
    );
    assert.deepEqual(steps, [1, 2], `split at ${cut}`);
    assert.equal(out.result.overall_theme, '漢字 theme ✨');
    assert.equal(out.profileId, 'abc');
  }
});

test('SseParser survives one-byte chunks', async () => {
  const steps: number[] = [];
  const chunks = [...SSE_DOC].map((c) => c);
  const out = await readForecastSseStream(streamOf(chunks), {
    onProgress: (s) => steps.push(s),
  });
  assert.deepEqual(steps, [1, 2]);
  assert.equal(out.result.overall_theme, '漢字 theme ✨');
});

test('readForecastSseStream handles chunked CRLF partial events', async () => {
  const chunks = [
    'event: progress\r\nda',
    'ta: {"step":1}\r\n\r\nevent: pro',
    'gress\r\ndata: {"step":2}\r\n\r\n',
    'event: result\r\ndata: {"result":{"overall_theme":"t","events":[],"ics_content":"ics"},"profileId":"abc"}\r\n\r\n',
  ];
  const steps: number[] = [];
  const out = await readForecastSseStream(streamOf(chunks), {
    onProgress: (s) => steps.push(s),
  });
  assert.deepEqual(steps, [1, 2]);
  assert.equal(out.profileId, 'abc');
  assert.equal(out.result.overall_theme, 't');
});

test('readForecastSseStream rejects error events and incomplete EOF', async () => {
  await assert.rejects(
    readForecastSseStream(
      streamOf(['event: error\ndata: {"error":"upstream down"}\n\n']),
      { onProgress: () => {} }
    ),
    /upstream down/
  );
  await assert.rejects(
    readForecastSseStream(
      streamOf(['event: progress\ndata: {"step":1}\n\nevent: result\nda']),
      { onProgress: () => {} }
    ),
    /incomplete|without a result/
  );
});

test('SseParser ignores comments and handles LF-only input', () => {
  const p = new SseParser();
  const msgs = p
    .push(new TextEncoder().encode(': ping\n\nevent: progress\ndata: {"step":3}\n\n'))
    .concat(p.end());
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].event, 'progress');
});
