import {
  ActivityCategory,
  ForecastResult,
  ImpactType,
  LifePriority,
  UserProfile,
} from '../types/astrology';

export const LIFE_PRIORITIES: LifePriority[] = [
  'careerTransition',
  'contractNegotiations',
  'datingRomance',
  'healthHabits',
  'financialPlanning',
];

export const PRIORITY_LABELS: Record<LifePriority, string> = {
  careerTransition: 'Career Transition',
  contractNegotiations: 'Contract Negotiations',
  datingRomance: 'Dating & Romance',
  healthHabits: 'Health & Habits',
  financialPlanning: 'Financial Planning',
};

export const IMPACT_TYPES: ImpactType[] = [
  'Opportunity',
  'Caution',
  'Milestone',
];

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  'career',
  'social',
  'hobbies',
  'finance',
  'wellness',
  'mind',
  'strategic',
  'rest',
];

export const DEFAULT_BACKEND_URL = '';
export const MAX_NAME_LENGTH = 120;
export const MAX_LOCATION_LENGTH = 200;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const ZODIAC_SET = new Set<string>([
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
]);

const PRIORITY_SET = new Set<string>(LIFE_PRIORITIES);
const IMPACT_SET = new Set<string>(IMPACT_TYPES);
const CATEGORY_SET = new Set<string>(ACTIVITY_CATEGORIES);

export function defaultTargetMonth(now: Date = new Date()): string {
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

export interface MonthRange {
  year: number;
  month: number;
  daysInMonth: number;
  firstDate: string;
  lastDate: string;
}

export function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatUtcDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export function parseMonthRange(input: unknown): MonthRange | null {
  if (typeof input !== 'string') return null;
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const monthIndex = MONTH_NAMES.indexOf(match[1]);
  if (monthIndex < 0) return null;
  const year = Number(match[2]);
  if (year < 1900 || year > 2200) return null;
  const month = monthIndex + 1;
  const days = daysInUtcMonth(year, month);
  return {
    year,
    month,
    daysInMonth: days,
    firstDate: formatUtcDate(year, month, 1),
    lastDate: formatUtcDate(year, month, days),
  };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(
  value: unknown
): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInUtcMonth(year, month)) return null;
  return { year, month, day };
}

export function isoDateToUtcMs(value: string): number {
  const p = parseIsoDate(value);
  if (!p) return NaN;
  return Date.UTC(p.year, p.month - 1, p.day);
}

export function inclusiveDaySpan(start: string, end: string): string[] {
  const startMs = isoDateToUtcMs(start);
  const endMs = isoDateToUtcMs(end);
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) return [];
  const out: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidBackendUrl(value: unknown): boolean {
  if (value === '' || value === undefined || value === null) return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}

function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100)
    return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isValidBirthTime(value: unknown): boolean {
  if (typeof value !== 'string' || !/^(\d{2}):(\d{2})$/.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidForecastShape(input: unknown): input is ForecastResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const obj = input as Record<string, unknown>;
  if (typeof obj.overall_theme !== 'string') return false;
  if (typeof obj.ics_content !== 'string' || !obj.ics_content.includes('BEGIN:VCALENDAR'))
    return false;
  if (!Array.isArray(obj.events)) return false;
  for (const ev of obj.events) {
    if (!ev || typeof ev !== 'object') return false;
    const e = ev as Record<string, unknown>;
    if (!parseIsoDate(e.date)) return false;
    if (e.end_date !== undefined && !parseIsoDate(e.end_date)) return false;
    if (typeof e.title !== 'string' || typeof e.summary !== 'string') return false;
    if (!IMPACT_SET.has(e.impact_type as string)) return false;
    if (
      !Array.isArray(e.topics) ||
      !e.topics.every((t: unknown) => PRIORITY_SET.has(t as string))
    )
      return false;
    if (!Array.isArray(e.source_urls) || !e.source_urls.every(isHttpUrl))
      return false;
  }
  return true;
}

export function mergeProfileWithDefaults(
  defaults: UserProfile,
  saved: unknown
): UserProfile {
  const merged: UserProfile = { ...defaults };
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const src = saved as Record<string, unknown>;
    const dst = merged as unknown as Record<string, unknown>;
    for (const key of Object.keys(defaults) as (keyof UserProfile)[]) {
      if (src[key] !== undefined) {
        dst[key] = src[key];
      }
    }
  }
  if (typeof merged.name !== 'string' || merged.name.length > MAX_NAME_LENGTH) {
    merged.name = defaults.name;
  }
  if (!parseIsoDate(merged.birthDate)) merged.birthDate = defaults.birthDate;
  if (!isValidBirthTime(merged.birthTime) && merged.birthTime !== '') {
    merged.birthTime = defaults.birthTime;
  }
  if (typeof merged.birthLocation !== 'string' || merged.birthLocation.length > MAX_LOCATION_LENGTH) {
    merged.birthLocation = defaults.birthLocation;
  }
  if (typeof merged.hasExactTime !== 'boolean') merged.hasExactTime = defaults.hasExactTime;
  if (typeof merged.useRisingPrimary !== 'boolean') merged.useRisingPrimary = defaults.useRisingPrimary;
  if (!ZODIAC_SET.has(merged.sunSign)) merged.sunSign = defaults.sunSign;
  if (!ZODIAC_SET.has(merged.moonSign)) merged.moonSign = defaults.moonSign;
  if (merged.risingSign !== undefined && !ZODIAC_SET.has(merged.risingSign)) {
    merged.risingSign = defaults.risingSign;
  }
  if (!isValidTimeZone(merged.birthTimezone)) merged.birthTimezone = defaults.birthTimezone;
  if (!isValidTimeZone(merged.operatingTimezone)) merged.operatingTimezone = defaults.operatingTimezone;
  if (!parseMonthRange(merged.targetMonth)) {
    merged.targetMonth = defaults.targetMonth;
  }
  if (!Array.isArray(merged.priorities)) {
    merged.priorities = [...defaults.priorities];
  } else {
    merged.priorities = merged.priorities.filter((p) =>
      PRIORITY_SET.has(p as string)
    ) as LifePriority[];
  }
  if (
    !Array.isArray(merged.activeCategories) ||
    merged.activeCategories.length === 0 ||
    !merged.activeCategories.every((c) => CATEGORY_SET.has(c))
  ) {
    merged.activeCategories = [...defaults.activeCategories];
  }
  if (!isValidBackendUrl(merged.backendUrl)) {
    merged.backendUrl = defaults.backendUrl;
  }
  return merged;
}
