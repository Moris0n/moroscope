import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultTargetMonth,
  isValidBackendUrl,
  isValidForecastShape,
  mergeProfileWithDefaults,
  parseMonthRange,
} from '../src/utils/forecastShared.ts';
import {
  SseParser,
  buildMonthlyHeatmap,
  readForecastSseStream,
} from '../src/utils/forecastHelpers.ts';
import { applyChart, chartBasis } from '../src/utils/chart.ts';
import { TransitEvent, UserProfile } from '../src/types/astrology.ts';

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
