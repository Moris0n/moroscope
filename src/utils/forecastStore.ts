import { StoredForecast } from '../types/astrology';
import {
  cleanLifeAreas,
  isValidForecastShape,
  isZodiacSign,
  parseEvidence,
  parseMonthRange,
  parseSourceReport,
} from './forecastShared';

// The shape of a stored record. Raise it when the record changes (a month review is expected to
// be added to it), so older records can be told apart and converted.
export const FORECAST_RECORD_VERSION = 1;
export const MAX_STORED_MONTHS = 6;

/** The latest forecast generated for one month, as kept on the device. */
export interface ForecastRecord {
  version: typeof FORECAST_RECORD_VERSION;
  month: string; // "November 2026"
  forecast: StoredForecast;
}

function reviveForecast(input: unknown, month: string): StoredForecast | null {
  if (!input || typeof input !== 'object') return null;
  const f = input as Record<string, unknown>;
  if (!isValidForecastShape(f.result)) return null;
  if (f.targetMonth !== month || typeof f.generatedAt !== 'string') return null;
  if (isNaN(Date.parse(f.generatedAt))) return null;
  if (!isZodiacSign(f.sign)) return null;
  if (f.mode !== 'general' && f.mode !== 'personal') return null;
  return {
    result: f.result,
    generatedAt: f.generatedAt,
    targetMonth: month,
    focusAreas: cleanLifeAreas(f.focusAreas),
    sign: f.sign,
    mode: f.mode,
    profileId: typeof f.profileId === 'string' ? f.profileId : null,
    sources: parseSourceReport(f.sources),
    evidence: parseEvidence(f.evidence),
  };
}

/** The stored records that can still be shown; anything else is dropped. One record per month. */
export function reviveForecastRecords(saved: unknown): ForecastRecord[] {
  if (!Array.isArray(saved)) return [];
  const byMonth = new Map<string, ForecastRecord>();
  for (const item of saved) {
    if (!item || typeof item !== 'object') continue;
    const { version, month, forecast } = item as Record<string, unknown>;
    if (version !== FORECAST_RECORD_VERSION) continue;
    if (typeof month !== 'string' || !parseMonthRange(month) || byMonth.has(month)) continue;
    const revived = reviveForecast(forecast, month);
    if (revived) byMonth.set(month, { version: FORECAST_RECORD_VERSION, month, forecast: revived });
  }
  return pruneForecastRecords([...byMonth.values()]);
}

/**
 * The most recently generated `max` records, newest first. A record for which `mustKeep` says
 * true is never dropped and does not count towards `max`.
 */
export function pruneForecastRecords(
  records: ForecastRecord[],
  mustKeep: (record: ForecastRecord) => boolean = () => false,
  max = MAX_STORED_MONTHS
): ForecastRecord[] {
  const newestFirst = [...records].sort((a, b) =>
    b.forecast.generatedAt.localeCompare(a.forecast.generatedAt)
  );
  let room = max;
  return newestFirst.filter((record) => mustKeep(record) || room-- > 0);
}

/** `records` with `forecast` as the record of its month, replacing an earlier one. */
export function withForecast(records: ForecastRecord[], forecast: StoredForecast): ForecastRecord[] {
  const month = forecast.targetMonth;
  return pruneForecastRecords([
    { version: FORECAST_RECORD_VERSION, month, forecast },
    ...records.filter((record) => record.month !== month),
  ]);
}

export function forecastForMonth(records: ForecastRecord[], month: string): StoredForecast | null {
  return records.find((record) => record.month === month)?.forecast ?? null;
}
