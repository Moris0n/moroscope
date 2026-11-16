import {
  ActivityCategory,
  ForecastResult,
  ImpactType,
  LifePriority,
  TransitEvent,
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

export const DEFAULT_TARGET_MONTH = 'November 2026';
export const DEFAULT_BACKEND_URL = '';
export const MAX_QUERY_LENGTH = 380;
export const MAX_EVENTS = 60;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 4000;
export const MAX_THEME_LENGTH = 8000;
export const MAX_SOURCE_URLS_PER_EVENT = 10;
export const MAX_RESULTS = 10;
export const MAX_RESULT_CONTENT_LENGTH = 12000;
export const MAX_EXCERPT_LENGTH = 8000;
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

export interface MonthRange {
  year: number;
  month: number;
  daysInMonth: number;
  firstDate: string;
  lastDate: string;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
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

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value
    )
  );
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

export type StoredProfile = Omit<UserProfile, 'backendUrl'>;

export interface ProfileValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateUserProfile(input: unknown): ProfileValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['profile must be an object'] };
  }
  const p = input as Record<string, unknown>;

  if (
    typeof p.name !== 'string' ||
    p.name.trim().length === 0 ||
    p.name.length > MAX_NAME_LENGTH
  ) {
    errors.push('name must be a nonempty string up to 120 chars');
  }
  if (!parseIsoDate(p.birthDate)) {
    errors.push('birthDate must be a real YYYY-MM-DD date');
  }
  if (typeof p.birthLocation !== 'string' || p.birthLocation.length > MAX_LOCATION_LENGTH) {
    errors.push('birthLocation must be a bounded string');
  }
  if (typeof p.hasExactTime !== 'boolean') {
    errors.push('hasExactTime must be a boolean');
  }
  if (typeof p.useRisingPrimary !== 'boolean') {
    errors.push('useRisingPrimary must be a boolean');
  }
  if (p.hasExactTime === true) {
    if (!isValidBirthTime(p.birthTime)) {
      errors.push('birthTime must be a valid HH:mm time');
    }
  } else if (p.birthTime !== undefined && p.birthTime !== '' && !isValidBirthTime(p.birthTime)) {
    errors.push('birthTime must be empty or a valid HH:mm time');
  }

  if (!ZODIAC_SET.has(p.sunSign as string)) {
    errors.push('sunSign must be a valid zodiac sign');
  }
  if (!ZODIAC_SET.has(p.moonSign as string)) {
    errors.push('moonSign must be a valid zodiac sign');
  }
  if (p.risingSign !== undefined && !ZODIAC_SET.has(p.risingSign as string)) {
    errors.push('risingSign must be a valid zodiac sign');
  }

  if (!isValidTimeZone(p.birthTimezone)) {
    errors.push('birthTimezone must be a valid IANA timezone');
  }
  if (!isValidTimeZone(p.operatingTimezone)) {
    errors.push('operatingTimezone must be a valid IANA timezone');
  }

  if (!parseMonthRange(p.targetMonth)) {
    errors.push('targetMonth must be in "Month YYYY" format, e.g. "November 2026"');
  }

  if (!Array.isArray(p.priorities)) {
    errors.push('priorities must be an array');
  } else {
    if (p.priorities.length > LIFE_PRIORITIES.length) {
      errors.push('priorities has too many entries');
    }
    for (const item of p.priorities) {
      if (!PRIORITY_SET.has(item as string)) {
        errors.push(`unknown priority: ${String(item)}`);
      }
    }
    if (new Set(p.priorities).size !== p.priorities.length) {
      errors.push('priorities must not contain duplicates');
    }
  }

  if (!Array.isArray(p.activeCategories) || p.activeCategories.length === 0) {
    errors.push('activeCategories must be a nonempty array');
  } else {
    if (p.activeCategories.length > ACTIVITY_CATEGORIES.length) {
      errors.push('activeCategories has too many entries');
    }
    for (const c of p.activeCategories) {
      if (typeof c !== 'string' || !CATEGORY_SET.has(c)) {
        errors.push(`unknown activity category: ${String(c)}`);
      }
    }
    if (new Set(p.activeCategories).size !== p.activeCategories.length) {
      errors.push('activeCategories must not contain duplicates');
    }
  }

  if (p.backendUrl !== undefined && !isValidBackendUrl(p.backendUrl)) {
    errors.push('backendUrl must be empty or a plain http(s) origin');
  }

  return { ok: errors.length === 0, errors };
}

const PROFILE_KEYS = [
  'name',
  'birthDate',
  'birthTime',
  'hasExactTime',
  'birthLocation',
  'birthTimezone',
  'operatingTimezone',
  'sunSign',
  'moonSign',
  'risingSign',
  'useRisingPrimary',
  'activeCategories',
  'targetMonth',
  'priorities',
] as const;

export function sanitizeProfile(input: unknown): StoredProfile {
  const src = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out as unknown as StoredProfile;
}

export function stripClientOnlyProfileFields(profile: unknown): StoredProfile {
  return sanitizeProfile(profile);
}

export function parseLlmJson(raw: string): unknown {
  let text = (raw || '').trim();
  const fence = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n?\s*```$/.exec(text);
  if (fence) text = fence[1].trim();
  return JSON.parse(text);
}

export interface ForecastValidationResult {
  ok: boolean;
  errors: string[];
  result?: { overall_theme: string; events: TransitEvent[] };
}

export function validateForecastPayload(
  input: unknown,
  range: MonthRange,
  selectedPriorities: LifePriority[],
  allowedSourceUrls: Set<string>
): ForecastValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['forecast must be a JSON object'] };
  }
  const obj = input as Record<string, unknown>;

  if (
    typeof obj.overall_theme !== 'string' ||
    obj.overall_theme.trim().length === 0 ||
    obj.overall_theme.length > MAX_THEME_LENGTH
  ) {
    errors.push('overall_theme must be a nonempty bounded string');
  }
  if (!Array.isArray(obj.events)) {
    errors.push('events must be an array');
    return { ok: false, errors };
  }
  if (obj.events.length > MAX_EVENTS) {
    errors.push(`events exceeds maximum of ${MAX_EVENTS}`);
  }

  const firstMs = isoDateToUtcMs(range.firstDate);
  const lastMs = isoDateToUtcMs(range.lastDate);
  const events: TransitEvent[] = [];
  let prevStart = -Infinity;

  obj.events.forEach((raw, idx) => {
    const label = `events[${idx}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${label} must be an object`);
      return;
    }
    const ev = raw as Record<string, unknown>;

    const start = parseIsoDate(ev.date);
    if (!start) {
      errors.push(`${label}.date must be a real YYYY-MM-DD date`);
      return;
    }
    const startMs = isoDateToUtcMs(ev.date as string);
    if (startMs < firstMs || startMs > lastMs) {
      errors.push(`${label}.date is outside the target month`);
    }

    let endMs = startMs;
    let endDate: string | undefined;
    if (ev.end_date !== undefined && ev.end_date !== null) {
      const end = parseIsoDate(ev.end_date);
      if (!end) {
        errors.push(`${label}.end_date must be a real YYYY-MM-DD date`);
        return;
      }
      endDate = ev.end_date as string;
      endMs = isoDateToUtcMs(endDate);
      if (endMs < startMs) {
        errors.push(`${label}.end_date must be >= date`);
      }
      if (endMs > lastMs) {
        errors.push(`${label}.end_date is outside the target month`);
      }
    }

    if (
      typeof ev.title !== 'string' ||
      ev.title.trim().length === 0 ||
      ev.title.length > MAX_TITLE_LENGTH
    ) {
      errors.push(`${label}.title must be a nonempty bounded string`);
    }
    if (!IMPACT_SET.has(ev.impact_type as string)) {
      errors.push(`${label}.impact_type must be Opportunity, Caution, or Milestone`);
    }
    if (
      typeof ev.summary !== 'string' ||
      ev.summary.trim().length === 0 ||
      ev.summary.length > MAX_SUMMARY_LENGTH
    ) {
      errors.push(`${label}.summary must be a nonempty bounded string`);
    }

    if (!Array.isArray(ev.topics) || ev.topics.length === 0) {
      errors.push(`${label}.topics must be a nonempty array`);
    } else {
      for (const t of ev.topics) {
        if (!PRIORITY_SET.has(t as string)) {
          errors.push(`${label}.topics contains unknown topic ${String(t)}`);
        }
      }
      if (new Set(ev.topics).size !== ev.topics.length) {
        errors.push(`${label}.topics must not contain duplicates`);
      }
      if (
        selectedPriorities.length > 0 &&
        !(ev.topics as unknown[]).some((t) =>
          selectedPriorities.includes(t as LifePriority)
        )
      ) {
        errors.push(`${label}.topics must include at least one selected priority`);
      }
    }

    if (!Array.isArray(ev.source_urls) || ev.source_urls.length === 0) {
      errors.push(`${label}.source_urls must be a nonempty array`);
    } else {
      if (ev.source_urls.length > MAX_SOURCE_URLS_PER_EVENT) {
        errors.push(`${label}.source_urls has too many entries`);
      }
      for (const u of ev.source_urls) {
        if (!isHttpUrl(u)) {
          errors.push(`${label}.source_urls must be http(s) URLs`);
        } else if (!allowedSourceUrls.has(u)) {
          errors.push(`${label}.source_urls contains a URL not in the search results`);
        }
      }
    }

    if (startMs < prevStart) {
      errors.push(`${label} is out of chronological order`);
    }
    prevStart = startMs;

    if (!errors.some((e) => e.startsWith(label))) {
      events.push({
        date: ev.date as string,
        ...(endDate ? { end_date: endDate } : {}),
        title: (ev.title as string).trim(),
        impact_type: ev.impact_type as ImpactType,
        summary: (ev.summary as string).trim(),
        topics: ev.topics as LifePriority[],
        source_urls: ev.source_urls as string[],
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    result: {
      overall_theme: (obj.overall_theme as string).trim(),
      events,
    },
  };
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

export function validateAgentQuery(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const q = (input as Record<string, unknown>).query;
  if (
    typeof q !== 'string' ||
    q.trim().length === 0 ||
    q.length > MAX_QUERY_LENGTH
  ) {
    return null;
  }
  return q.trim();
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
