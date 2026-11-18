import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanLifeContext,
  defaultTargetMonth,
  isLegacyProfile,
  isValidBackendUrl,
  isValidForecastShape,
  mergeProfileWithDefaults,
  normalizeSourceUrl,
  parseMonthRange,
  primarySign,
  profileProblem,
  profileRequestBody,
  reviveSourceSettings,
  sourcesRequestBody,
  toGeneralProfile,
  toggleKidsStage,
} from '../src/utils/forecastShared.ts';
import {
  SseParser,
  buildMonthlyHeatmap,
  parseForecastPayload,
  readForecastSseStream,
  sourceLabel,
} from '../src/utils/forecastHelpers.ts';
import { applyChart, chartBasis } from '../src/utils/chart.ts';
import { TransitEvent, UserProfile } from '../src/types/astrology.ts';

const VALID_PROFILE: UserProfile = {
  mode: 'personal',
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
  assert.equal(merged.targetMonth, VALID_PROFILE.targetMonth);
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
  assert.equal(corrupt.targetMonth, VALID_PROFILE.targetMonth);
  assert.equal(corrupt.sunSign, VALID_PROFILE.sunSign);
  assert.equal(corrupt.moonSign, VALID_PROFILE.moonSign);
  assert.equal(corrupt.operatingTimezone, VALID_PROFILE.operatingTimezone);
  assert.deepEqual(corrupt.activeCategories, VALID_PROFILE.activeCategories);
  assert.equal(corrupt.backendUrl, '');
  assert.equal(corrupt.birthTime, VALID_PROFILE.birthTime);
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

test('defaultTargetMonth follows the current date and always parses', () => {
  assert.equal(defaultTargetMonth(new Date(2027, 0, 31)), 'January 2027');
  assert.equal(defaultTargetMonth(new Date(2026, 11, 1)), 'December 2026');
  assert.ok(parseMonthRange(defaultTargetMonth()));
});

test('chartBasis is the chart request body and changes only with birth data', () => {
  const place = { label: 'New York City', lat: 40.7143, lon: -74.006, tz: 'America/New_York' };
  const withPlace = { ...VALID_PROFILE, birthPlace: place };
  assert.deepEqual(JSON.parse(chartBasis(withPlace)!), {
    birthDate: '1994-10-17',
    birthTime: '08:45',
    timeKnown: true,
    place: { tz: 'America/New_York', lat: 40.7143, lon: -74.006 },
  });
  assert.deepEqual(JSON.parse(chartBasis(VALID_PROFILE)!).place, { tz: 'America/New_York' });
  assert.deepEqual(
    JSON.parse(chartBasis({ ...withPlace, hasExactTime: false })!),
    {
      birthDate: '1994-10-17',
      timeKnown: false,
      place: { tz: 'America/New_York', lat: 40.7143, lon: -74.006 },
    }
  );
  // Coordinates are dropped when they belong to a different timezone than the one in use.
  assert.deepEqual(
    JSON.parse(chartBasis({ ...withPlace, birthTimezone: 'Europe/London' })!).place,
    { tz: 'Europe/London' }
  );

  assert.equal(chartBasis({ ...withPlace, name: 'Other', sunSign: 'Leo' }), chartBasis(withPlace));
  assert.notEqual(chartBasis({ ...withPlace, birthTime: '09:00' }), chartBasis(withPlace));

  assert.equal(chartBasis({ ...VALID_PROFILE, birthDate: '' }), null);
  assert.equal(chartBasis({ ...VALID_PROFILE, birthDate: '1850-01-01' }), null);
  assert.equal(chartBasis({ ...VALID_PROFILE, birthTime: '' }), null);
  assert.notEqual(chartBasis({ ...VALID_PROFILE, birthTime: '', hasExactTime: false }), null);
});

test('applyChart replaces the signs and decides whether the Rising sign leads', () => {
  const chart = {
    sun: 'Libra',
    moon: 'Aries',
    rising: 'Scorpio',
    sunUncertain: false,
    moonUncertain: false,
  } as const;
  const overridden: UserProfile = { ...VALID_PROFILE, sunSign: 'Leo', useRisingPrimary: false };
  const applied = applyChart(overridden, chart, 'basis-1');
  assert.equal(applied.sunSign, 'Libra');
  assert.equal(applied.moonSign, 'Aries');
  assert.equal(applied.useRisingPrimary, false);
  assert.deepEqual(applied.chart, { ...chart, basis: 'basis-1' });

  const newlyRising = applyChart(
    { ...VALID_PROFILE, risingSign: undefined, useRisingPrimary: false },
    chart,
    'b'
  );
  assert.equal(newlyRising.risingSign, 'Scorpio');
  assert.equal(newlyRising.useRisingPrimary, true);

  const { rising: _, ...withoutRising } = chart;
  const noRising = applyChart(VALID_PROFILE, { ...withoutRising, moonUncertain: true }, 'b');
  assert.equal(noRising.risingSign, undefined);
  assert.equal(noRising.useRisingPrimary, false);
  assert.equal(noRising.chart?.moonUncertain, true);
});

test('mergeProfileWithDefaults never pairs the default place or chart with saved birth data', () => {
  const place = { label: 'New York City', lat: 40.7143, lon: -74.006, tz: 'America/New_York' };
  const chart = {
    sun: 'Libra',
    moon: 'Aries',
    sunUncertain: false,
    moonUncertain: true,
    basis: 'x',
  } as const;
  const defaults: UserProfile = { ...VALID_PROFILE, birthPlace: place, chart };

  const legacy = mergeProfileWithDefaults(defaults, { name: 'Old User', birthDate: '1990-01-15' });
  assert.equal(legacy.birthPlace, undefined);
  assert.equal(legacy.chart, undefined);

  const haifa = { label: 'Haifa, Israel', lat: 32.8156, lon: 34.9892, tz: 'Asia/Jerusalem' };
  const kept = mergeProfileWithDefaults(defaults, { birthPlace: haifa, chart });
  assert.deepEqual(kept.birthPlace, haifa);
  assert.deepEqual(kept.chart, chart);

  const corrupt = mergeProfileWithDefaults(defaults, {
    birthPlace: { ...haifa, lat: 120 },
    chart: { ...chart, sun: 'Ophiuchus' },
  });
  assert.equal(corrupt.birthPlace, undefined);
  assert.equal(corrupt.chart, undefined);

  assert.deepEqual(mergeProfileWithDefaults(defaults, null).birthPlace, place);
});

test('a general profile sends only its sign, month and topics', () => {
  const general = toGeneralProfile(
    { ...VALID_PROFILE, lifeContext: { work: 'jobSeeking' } },
    'Scorpio'
  );
  assert.equal(general.name, '');
  assert.equal(general.birthDate, '');
  assert.equal(general.lifeContext, undefined);
  assert.equal(general.risingSign, undefined);
  assert.deepEqual(primarySign(general), { sign: 'Scorpio', kind: 'chosen' });
  assert.deepEqual(profileRequestBody(general), {
    mode: 'general',
    sunSign: 'Scorpio',
    targetMonth: 'November 2026',
    priorities: ['careerTransition', 'financialPlanning'],
  });
  assert.equal(profileProblem(general), null);
  // Even with leftover fields, nothing else is sent.
  const leftovers = profileRequestBody({ ...VALID_PROFILE, mode: 'general' });
  assert.deepEqual(Object.keys(leftovers).sort(), ['mode', 'priorities', 'sunSign', 'targetMonth']);
});

test('a personal profile sends cleaned life context only with a forecast', () => {
  const profile: UserProfile = {
    ...VALID_PROFILE,
    birthPlace: { label: 'X', lat: 1, lon: 2, tz: 'America/New_York' },
    lifeContext: {
      work: 'jobSeeking',
      kids: [],
      lookingForPartner: false,
      goals: '  New job  ',
      upcomingEvents: [
        { date: '2026-11-16', label: ' Interview ' },
        { date: '', label: 'half-filled row' },
      ],
    },
  };
  const body = profileRequestBody(profile);
  assert.deepEqual(body.lifeContext, {
    work: 'jobSeeking',
    goals: 'New job',
    upcomingEvents: [{ date: '2026-11-16', label: 'Interview' }],
  });
  for (const key of ['backendUrl', 'chart', 'birthPlace']) assert.equal(key in body, false);
  assert.equal(body.name, 'Test User');
  assert.equal('lifeContext' in profileRequestBody(profile, { lifeContext: false }), false);
  assert.equal('lifeContext' in profileRequestBody({ ...profile, lifeContext: { kids: [] } }), false);
  assert.deepEqual(primarySign(profile), { sign: 'Scorpio', kind: 'rising' });
  assert.deepEqual(primarySign({ ...profile, hasExactTime: false }), { sign: 'Libra', kind: 'sun' });
  assert.match(profileProblem({ ...profile, birthDate: '' })!, /birth date/);
  assert.equal(profileProblem(profile), null);
});

test('cleanLifeContext drops unknown answers and keeps half-typed rows while editing', () => {
  const messy = {
    relationship: 'royal',
    work: 'student',
    kids: ['teens', 'teens', 'aliens'],
    healthFocus: 'sleep',
    caringForParents: true,
    goals: 'x'.repeat(600),
    upcomingEvents: [{ date: '', label: '' }, 'nope'],
    extra: 1,
  };
  const sent = cleanLifeContext(messy);
  assert.deepEqual(Object.keys(sent).sort(), ['caringForParents', 'goals', 'kids', 'work']);
  assert.deepEqual(sent.kids, ['teens']);
  assert.equal(sent.goals!.length, 500);
  assert.deepEqual(cleanLifeContext(messy, false).upcomingEvents, [{ date: '', label: '' }]);
  assert.deepEqual(cleanLifeContext(null), {});
});

test('stored profiles: legacy ones are personal and onboarded, modes and life context survive', () => {
  const defaults: UserProfile = { ...VALID_PROFILE, mode: 'general', name: '', birthDate: '' };
  const legacy = { name: 'Old User', birthDate: '1990-01-15', sunSign: 'Capricorn' };
  assert.equal(isLegacyProfile(legacy), true);
  assert.equal(isLegacyProfile({ ...legacy, mode: 'personal' }), false);
  assert.equal(isLegacyProfile(null), false);
  assert.equal(mergeProfileWithDefaults(defaults, legacy).mode, 'personal');

  const stored = { mode: 'general', sunSign: 'Leo', birthDate: '' };
  const general = mergeProfileWithDefaults(defaults, stored);
  assert.equal(general.mode, 'general');
  assert.equal(general.birthDate, '');
  assert.equal(mergeProfileWithDefaults(defaults, { mode: 'weird' }).mode, 'general');

  const personal = mergeProfileWithDefaults(defaults, {
    mode: 'personal',
    lifeContext: { work: 'retired', moneyFocus: 'lottery' },
  });
  assert.deepEqual(personal.lifeContext, { work: 'retired' });
});

test('source addresses are normalised, deduplicated and bounded', () => {
  assert.equal(normalizeSourceUrl(' example.com/monthly '), 'https://example.com/monthly');
  assert.equal(normalizeSourceUrl('http://Example.com#top'), 'http://example.com/');
  for (const bad of ['', 'not a url', 'ftp://x.example', 'https://u:p@x.example', 'localhost', 'javascript:alert(1)']) {
    assert.equal(normalizeSourceUrl(bad), null, bad);
  }

  const revived = reviveSourceSettings({
    disabledCurated: ['astrostyle', 5],
    user: [
      { id: 'a', url: 'https://www.site.example/monthly/', active: true },
      { id: 'b', url: 'https://site.example/monthly', active: true },
      { id: 'c', url: 'https://other.example', active: false },
      { id: '', url: 'https://noid.example' },
      { id: 'd', url: 'nope nope' },
      'junk',
    ],
  });
  assert.deepEqual(revived.disabledCurated, ['astrostyle']);
  assert.deepEqual(revived.user.map((s) => [s.id, s.active]), [['a', true], ['c', false]]);
  assert.deepEqual(reviveSourceSettings('old fake list'), { disabledCurated: [], user: [] });
  assert.deepEqual(reviveSourceSettings([{ id: 'src-astrology-zone' }]), { disabledCurated: [], user: [] });
  assert.equal(sourcesRequestBody(revived, true).includeCurated, true);
  assert.equal(sourcesRequestBody(revived).includeCurated, false);
});

test('forecast payload extras are parsed defensively and cited URLs get source names', () => {
  const payload = parseForecastPayload({
    result: {},
    profileId: 7,
    evidence: { mode: 'user', gap: true },
    sources: [
      { id: 'rux-youtube', name: 'Rux', url: 'https://www.youtube.com/@Rux', origin: 'curated', status: 'used', documents: 2 },
      { id: 'x', name: 'Bad', url: 'javascript:alert(1)', origin: 'user', status: 'failed', reason: 'HTTP 404' },
      { id: 'y', name: 'Unknown status', url: '', origin: 'user', status: 'exploded' },
      'junk',
    ],
  });
  assert.equal(payload.profileId, null);
  assert.deepEqual(payload.evidence, { mode: 'user', gap: true });
  assert.deepEqual(payload.sources.map((s) => [s.id, s.url]), [
    ['rux-youtube', 'https://www.youtube.com/@Rux'],
    ['x', ''],
  ]);
  assert.equal(parseForecastPayload({}).evidence, null);
  assert.deepEqual(parseForecastPayload({ evidence: { mode: 'magic', gap: false } }).sources, []);

  const { sources } = payload;
  assert.equal(sourceLabel('https://www.youtube.com/watch?v=abc&t=12456s', sources), 'Rux (at 3:27:36)');
  assert.equal(sourceLabel('https://www.youtube.com/watch?v=abc', sources), 'Rux');
  assert.equal(sourceLabel('https://www.astrostyle.com/horoscopes/', sources), 'astrostyle.com');
  assert.equal(sourceLabel('not a url', sources), 'not a url');
});

test('children answers: "No children" excludes having children but not trying for one', () => {
  assert.deepEqual(toggleKidsStage([], 'none'), ['none']);
  assert.deepEqual(toggleKidsStage(['none'], 'trying'), ['none', 'trying']);
  assert.deepEqual(toggleKidsStage(['none', 'trying'], 'under5'), ['trying', 'under5']);
  assert.deepEqual(toggleKidsStage(['trying', 'under5', 'teens'], 'none'), ['trying', 'none']);
  assert.deepEqual(toggleKidsStage(['none'], 'none'), []);
  assert.deepEqual(cleanLifeContext({ kids: ['none', 'trying'] }).kids, ['none', 'trying']);
});
