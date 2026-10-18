export interface TimezoneOption {
  id: string;
  label: string;
  region: string;
  city: string;
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { id: 'UTC', label: 'UTC (Coordinated Universal Time)', region: 'Global', city: 'UTC / Greenwich' },
  { id: 'America/New_York', label: 'Eastern Time (New York, Toronto)', region: 'Americas', city: 'New York' },
  { id: 'America/Chicago', label: 'Central Time (Chicago, Mexico City)', region: 'Americas', city: 'Chicago' },
  { id: 'America/Denver', label: 'Mountain Time (Denver, Phoenix)', region: 'Americas', city: 'Denver' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles, Vancouver)', region: 'Americas', city: 'Los Angeles' },
  { id: 'America/Sao_Paulo', label: 'Brasília Time (São Paulo, Rio)', region: 'Americas', city: 'São Paulo' },
  { id: 'Europe/London', label: 'UK Time (London, Dublin, Lisbon)', region: 'Europe', city: 'London' },
  { id: 'Europe/Paris', label: 'Central European (Paris, Berlin, Madrid)', region: 'Europe', city: 'Paris / Berlin' },
  { id: 'Europe/Athens', label: 'Eastern European (Athens, Helsinki, Cairo)', region: 'Europe', city: 'Athens' },
  { id: 'Asia/Dubai', label: 'Gulf Standard Time (Dubai, Abu Dhabi)', region: 'Middle East', city: 'Dubai' },
  { id: 'Asia/Kolkata', label: 'India Standard Time (Mumbai, New Delhi)', region: 'Asia', city: 'Mumbai / Delhi' },
  { id: 'Asia/Singapore', label: 'Singapore / China Time (Singapore, Hong Kong)', region: 'Asia', city: 'Singapore' },
  { id: 'Asia/Tokyo', label: 'Japan Standard Time (Tokyo, Seoul)', region: 'Asia', city: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Australian Eastern (Sydney, Melbourne)', region: 'Oceania', city: 'Sydney' },
  { id: 'Pacific/Auckland', label: 'New Zealand Time (Auckland, Wellington)', region: 'Oceania', city: 'Auckland' },
];

export function detectLocalTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && typeof detected === 'string') {
      return detected;
    }
  } catch {
    // Fallback if Intl fails
  }
  return 'America/New_York';
}

/**
 * Returns the offset in minutes from UTC for a given IANA timezone at a specific date.
 * Positive values mean ahead of UTC (e.g., Tokyo = +540), negative values mean behind UTC (e.g., NY = -240).
 */
export function getTimezoneOffsetMinutes(timeZone: string, referenceDate: Date = new Date()): number {
  try {
    const utcDate = new Date(referenceDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(referenceDate.toLocaleString('en-US', { timeZone }));
    return Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Formats an IANA timezone into a clean human-readable offset string, e.g. "UTC-04:00 · America/New_York"
 */
export function formatTimezoneBadge(timeZone: string, referenceDate: Date = new Date()): string {
  const offsetMins = getTimezoneOffsetMinutes(timeZone, referenceDate);
  const sign = offsetMins >= 0 ? '+' : '-';
  const absMins = Math.abs(offsetMins);
  const hours = String(Math.floor(absMins / 60)).padStart(2, '0');
  const mins = String(absMins % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${mins}`;
}

export function formatHourDecimal(hourDecimal: number): string {
  const wrapped = ((hourDecimal % 24) + 24) % 24;
  const hours = Math.floor(wrapped);
  const minutes = Math.round((wrapped - hours) * 60) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Step 1 of Normalization Pipeline:
 * Converts a native decimal hour (0..24) from a source's publication timezone into normalized UTC (0..24)
 * along with any day boundary shift (-1, 0, +1).
 */
export function normalizeSourceHourToUtc(
  nativeHour: number,
  sourceTimezone: string,
  referenceDate: Date = new Date()
): { utcHour: number; dayShiftFromSourceToUtc: number } {
  const sourceOffsetHours = getTimezoneOffsetMinutes(sourceTimezone, referenceDate) / 60;
  const rawUtc = nativeHour - sourceOffsetHours;
  let dayShift = 0;
  if (rawUtc < 0) dayShift = -1;
  if (rawUtc >= 24) dayShift = 1;
  const utcHour = ((rawUtc % 24) + 24) % 24;
  return { utcHour, dayShiftFromSourceToUtc: dayShift };
}

/**
 * Step 2 of Normalization Pipeline:
 * Projects a normalized UTC decimal hour (0..24) into the user's operating timezone (0..24),
 * tracking day boundary shifts.
 */
export function projectUtcHourToUserLocal(
  utcHour: number,
  userOperatingTimezone: string,
  referenceDate: Date = new Date()
): { localHour: number; dayShiftFromUtcToLocal: number } {
  const userOffsetHours = getTimezoneOffsetMinutes(userOperatingTimezone, referenceDate) / 60;
  const rawLocal = utcHour + userOffsetHours;
  let dayShift = 0;
  if (rawLocal < 0) dayShift = -1;
  if (rawLocal >= 24) dayShift = 1;
  const localHour = ((rawLocal % 24) + 24) % 24;
  return { localHour, dayShiftFromUtcToLocal: dayShift };
}

/**
 * Full 2-stage Timezone Normalization & Projection Pipeline:
 * Source Native Timezone -> Defaulted UTC -> User Operating Timezone
 */
export function convertSourceWindowToUserTimezone(
  nativeStartHour: number,
  nativeEndHour: number,
  sourceTimezone: string,
  userOperatingTimezone: string,
  referenceDate: Date = new Date()
): {
  sourceNativeWindow: string;
  utcWindow: string;
  localWindow: string;
  localStartHour: number;
  localEndHour: number;
  dayShiftNote?: string;
} {
  const startUtcObj = normalizeSourceHourToUtc(nativeStartHour, sourceTimezone, referenceDate);
  const endUtcObj = normalizeSourceHourToUtc(nativeEndHour, sourceTimezone, referenceDate);

  const startLocalObj = projectUtcHourToUserLocal(startUtcObj.utcHour, userOperatingTimezone, referenceDate);
  const endLocalObj = projectUtcHourToUserLocal(endUtcObj.utcHour, userOperatingTimezone, referenceDate);

  const totalDayShift = startUtcObj.dayShiftFromSourceToUtc + startLocalObj.dayShiftFromUtcToLocal;

  const sourceTzShort = sourceTimezone.split('/').pop()?.replace('_', ' ') || sourceTimezone;
  const userTzBadge = formatTimezoneBadge(userOperatingTimezone, referenceDate);

  const sourceNativeWindow = `${formatHourDecimal(nativeStartHour)}–${formatHourDecimal(nativeEndHour)} (${sourceTzShort})`;
  const utcWindow = `${formatHourDecimal(startUtcObj.utcHour)}–${formatHourDecimal(endUtcObj.utcHour)} UTC`;
  const localWindow = `${formatHourDecimal(startLocalObj.localHour)}–${formatHourDecimal(endLocalObj.localHour)} (${userTzBadge})`;

  let dayShiftNote: string | undefined;
  if (totalDayShift > 0) {
    dayShiftNote = `+1 day vs. ${sourceTzShort} publication`;
  } else if (totalDayShift < 0) {
    dayShiftNote = `-1 day vs. ${sourceTzShort} publication`;
  }

  return {
    sourceNativeWindow,
    utcWindow,
    localWindow,
    localStartHour: Math.floor(startLocalObj.localHour),
    localEndHour: Math.floor(endLocalObj.localHour),
    dayShiftNote,
  };
}
