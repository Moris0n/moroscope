import {
  BirthPlace,
  EventType,
  ForecastEvidence,
  ForecastResult,
  HealthFocus,
  KidsStage,
  LifeArea,
  LifeContext,
  MoneyFocus,
  NatalChart,
  ProfileRequest,
  RelationshipStatus,
  SourceReport,
  SourceSettings,
  UserProfile,
  UserSource,
  WorkStatus,
  ZodiacSign,
} from '../types/astrology';

// The life areas in display order. The ids and labels match backend/app/models.py.
export const LIFE_AREA_LABELS: Record<LifeArea, string> = {
  career: 'Career & Work',
  money: 'Money & Resources',
  love: 'Love & Relationships',
  family: 'Family & Home',
  health: 'Health & Wellbeing',
  community: 'Friends & Community',
  communication: 'Communication & Contracts',
  learning: 'Learning & Travel',
  creativity: 'Creativity & Fun',
  rest: 'Rest & Inner Life',
};

export const LIFE_AREAS = Object.keys(LIFE_AREA_LABELS) as LifeArea[];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  keyDate: 'Key date',
  goodTime: 'Good time',
  caution: 'Be careful',
};

export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as EventType[];

// The five focus topics of profiles stored before the life areas existed.
const LEGACY_PRIORITY_AREAS: Record<string, LifeArea> = {
  careerTransition: 'career',
  contractNegotiations: 'communication',
  datingRomance: 'love',
  healthHabits: 'health',
  financialPlanning: 'money',
};

export const DEFAULT_BACKEND_URL = '';
export const MAX_NAME_LENGTH = 120;
export const MAX_LOCATION_LENGTH = 200;
export const MAX_GOALS_LENGTH = 500;
export const MAX_UPCOMING_EVENTS = 10;
export const MAX_EVENT_LABEL_LENGTH = 120;
export const MAX_USER_SOURCES = 10;
export const MAX_SOURCE_URL_LENGTH = 500;

type Options<T extends string> = { value: T; label: string }[];

export const RELATIONSHIP_OPTIONS: Options<RelationshipStatus> = [
  { value: 'single', label: 'Single' },
  { value: 'dating', label: 'Dating' },
  { value: 'inRelationship', label: 'In a relationship' },
  { value: 'married', label: 'Married' },
  { value: 'separated', label: 'Separated' },
  { value: 'complicated', label: "It's complicated" },
];

export const WORK_OPTIONS: Options<WorkStatus> = [
  { value: 'employed', label: 'Employed' },
  { value: 'jobSeeking', label: 'Looking for a job' },
  { value: 'consideringChange', label: 'Considering a change' },
  { value: 'selfEmployed', label: 'Self-employed' },
  { value: 'student', label: 'Student' },
  { value: 'parentalLeave', label: 'Parental leave' },
  { value: 'retired', label: 'Retired' },
];

export const MONEY_OPTIONS: Options<MoneyFocus> = [
  { value: 'saving', label: 'Saving' },
  { value: 'bigPurchase', label: 'A big purchase' },
  { value: 'investing', label: 'Investing' },
  { value: 'debt', label: 'Paying off debt' },
];

export const KIDS_OPTIONS: Options<KidsStage> = [
  { value: 'none', label: 'No children' },
  { value: 'trying', label: 'Trying for a baby' },
  { value: 'expecting', label: 'Expecting' },
  { value: 'under5', label: 'Under 5' },
  { value: 'age5to12', label: '5 to 12' },
  { value: 'teens', label: 'Teenagers' },
  { value: 'adult', label: 'Grown-up' },
];

/** Toggle one "Children" answer: "No children" and having children rule each other out. */
export function toggleKidsStage(current: KidsStage[], stage: KidsStage): KidsStage[] {
  if (current.includes(stage)) return current.filter((s) => s !== stage);
  if (stage === 'none') return [...current.filter((s) => s === 'trying'), 'none'];
  return [...current.filter((s) => s !== 'none' || stage === 'trying'), stage];
}

export const HEALTH_OPTIONS: Options<HealthFocus> = [
  { value: 'fitness', label: 'Fitness' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'stress', label: 'Stress' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'habit', label: 'A specific habit' },
];

export const DEFAULT_SOURCE_SETTINGS: SourceSettings = { disabledCurated: [], user: [] };

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

export const isZodiacSign = (value: unknown): value is ZodiacSign =>
  ZODIAC_SET.has(value as string);

const LIFE_AREA_SET = new Set<string>(LIFE_AREAS);
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

/** The known life areas in `input`, in its order, each once. */
export function cleanLifeAreas(input: unknown): LifeArea[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((a) => LIFE_AREA_SET.has(a)))] as LifeArea[];
}

/**
 * The focus areas of a stored profile. One from before the life areas existed has `priorities`
 * (five topics) instead: each is carried over to the life area that replaced it.
 */
export function storedFocusAreas(saved: unknown, fallback: LifeArea[]): LifeArea[] {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return [...fallback];
  const src = saved as Record<string, unknown>;
  if (Array.isArray(src.focusAreas)) return cleanLifeAreas(src.focusAreas);
  if (Array.isArray(src.priorities)) {
    return cleanLifeAreas(src.priorities.map((p) => LEGACY_PRIORITY_AREAS[p as string]));
  }
  return [...fallback];
}

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

export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100)
    return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidBirthTime(value: unknown): boolean {
  if (typeof value !== 'string' || !/^(\d{2}):(\d{2})$/.test(value)) return false;
  const [h, m] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isValidForecastShape(input: unknown): input is ForecastResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const obj = input as Record<string, unknown>;
  if (typeof obj.theme !== 'string') return false;
  if (typeof obj.icsContent !== 'string' || !obj.icsContent.includes('BEGIN:VCALENDAR'))
    return false;
  if (!Array.isArray(obj.events)) return false;
  const ids = new Set<string>();
  for (const ev of obj.events) {
    if (!ev || typeof ev !== 'object') return false;
    const e = ev as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id)) return false;
    ids.add(e.id);
    if (!parseIsoDate(e.date)) return false;
    if (e.endDate !== undefined && !parseIsoDate(e.endDate)) return false;
    if (typeof e.title !== 'string' || typeof e.summary !== 'string') return false;
    if (e.personalNote !== undefined && typeof e.personalNote !== 'string') return false;
    if (!EVENT_TYPE_SET.has(e.type as string)) return false;
    if (
      !Array.isArray(e.lifeAreas) ||
      !e.lifeAreas.every((a: unknown) => LIFE_AREA_SET.has(a as string))
    )
      return false;
    if (!Array.isArray(e.sourceUrls) || !e.sourceUrls.every(isHttpUrl)) return false;
  }
  return true;
}

export function isBirthPlace(input: unknown): input is BirthPlace {
  if (!input || typeof input !== 'object') return false;
  const p = input as Record<string, unknown>;
  return (
    typeof p.label === 'string' &&
    p.label.length <= MAX_LOCATION_LENGTH &&
    typeof p.lat === 'number' &&
    Math.abs(p.lat) <= 90 &&
    typeof p.lon === 'number' &&
    Math.abs(p.lon) <= 180 &&
    isValidTimeZone(p.tz)
  );
}

export function isNatalChart(input: unknown): input is NatalChart {
  return isChartResponse(input) && typeof (input as { basis?: unknown }).basis === 'string';
}

export function isChartResponse(input: unknown): input is Omit<NatalChart, 'basis'> {
  if (!input || typeof input !== 'object') return false;
  const c = input as Record<string, unknown>;
  return (
    ZODIAC_SET.has(c.sun as string) &&
    ZODIAC_SET.has(c.moon as string) &&
    (c.rising === undefined || ZODIAC_SET.has(c.rising as string)) &&
    typeof c.sunUncertain === 'boolean' &&
    typeof c.moonUncertain === 'boolean'
  );
}

const optionValues = <T extends string>(options: Options<T>) =>
  new Set<string>(options.map((o) => o.value));

function pickOne<T extends string>(value: unknown, options: Options<T>): T | undefined {
  return typeof value === 'string' && optionValues(options).has(value) ? (value as T) : undefined;
}

function pickMany<T extends string>(value: unknown, options: Options<T>): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = optionValues(options);
  const kept = [...new Set(value.filter((v) => typeof v === 'string' && allowed.has(v)))] as T[];
  return kept.length > 0 ? kept : undefined;
}

/**
 * The answered parts of a life context, in the shape the server accepts. With `complete`, rows
 * of upcoming events that still lack a date or a label are dropped (for sending); without it they
 * are kept (so a half-filled row survives while the user types).
 */
export function cleanLifeContext(input: unknown, complete = true): LifeContext {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: LifeContext = {
    relationship: pickOne(src.relationship, RELATIONSHIP_OPTIONS),
    work: pickOne(src.work, WORK_OPTIONS),
    moneyFocus: pickOne(src.moneyFocus, MONEY_OPTIONS),
    kids: pickMany(src.kids, KIDS_OPTIONS),
    healthFocus: pickMany(src.healthFocus, HEALTH_OPTIONS),
    lookingForPartner: src.lookingForPartner === true ? true : undefined,
    caringForParents: src.caringForParents === true ? true : undefined,
  };
  if (typeof src.goals === 'string') {
    const goals = (complete ? src.goals.trim() : src.goals).slice(0, MAX_GOALS_LENGTH);
    if (goals) out.goals = goals;
  }
  if (Array.isArray(src.upcomingEvents)) {
    const events = src.upcomingEvents
      .filter((e): e is { date: unknown; label: unknown } => !!e && typeof e === 'object')
      .map((e) => ({
        date: typeof e.date === 'string' ? e.date : '',
        label: (typeof e.label === 'string' ? e.label : '').slice(0, MAX_EVENT_LABEL_LENGTH),
      }))
      .filter((e) => !complete || (parseIsoDate(e.date) && e.label.trim()))
      .map((e) => (complete ? { ...e, label: e.label.trim() } : e))
      .slice(0, MAX_UPCOMING_EVENTS);
    if (events.length > 0) out.upcomingEvents = events;
  }
  for (const key of Object.keys(out) as (keyof LifeContext)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

/** The sign a forecast is read for, and why: the Rising sign leads only in a personal profile. */
export function primarySign(profile: UserProfile): {
  sign: ZodiacSign;
  kind: 'chosen' | 'rising' | 'sun';
} {
  if (profile.mode === 'general') return { sign: profile.sunSign, kind: 'chosen' };
  if (profile.hasExactTime && profile.useRisingPrimary && profile.risingSign) {
    return { sign: profile.risingSign, kind: 'rising' };
  }
  return { sign: profile.sunSign, kind: 'sun' };
}

/**
 * What is sent to the server for a profile. A general profile sends its sign, the month and the
 * focus areas and nothing else. The life context is included only when asked for (forecasts),
 * never when the profile is saved.
 */
export function profileRequestBody(
  profile: UserProfile,
  options: { lifeContext: boolean } = { lifeContext: true }
): ProfileRequest {
  if (profile.mode === 'general') {
    return {
      mode: 'general',
      sunSign: profile.sunSign,
      targetMonth: profile.targetMonth,
      focusAreas: profile.focusAreas,
    };
  }
  const context = options.lifeContext ? cleanLifeContext(profile.lifeContext) : {};
  return {
    mode: 'personal',
    name: profile.name,
    birthDate: profile.birthDate,
    birthTime: profile.birthTime,
    hasExactTime: profile.hasExactTime,
    birthLocation: profile.birthLocation,
    birthTimezone: profile.birthTimezone,
    operatingTimezone: profile.operatingTimezone,
    sunSign: profile.sunSign,
    moonSign: profile.moonSign,
    ...(profile.risingSign ? { risingSign: profile.risingSign } : {}),
    useRisingPrimary: profile.useRisingPrimary,
    targetMonth: profile.targetMonth,
    focusAreas: profile.focusAreas,
    ...(Object.keys(context).length > 0 ? { lifeContext: context } : {}),
  };
}

/** A general profile for `sign`: every personal detail of `profile` is dropped. */
export function toGeneralProfile(profile: UserProfile, sign: ZodiacSign): UserProfile {
  return {
    ...profile,
    mode: 'general',
    lifeContext: undefined,
    name: '',
    birthDate: '',
    birthTime: '',
    hasExactTime: false,
    birthLocation: '',
    birthPlace: undefined,
    birthTimezone: profile.operatingTimezone,
    sunSign: sign,
    moonSign: sign,
    risingSign: undefined,
    chart: undefined,
    useRisingPrimary: false,
  };
}

/** Why a personal profile cannot be used for a forecast yet, or null if it can. */
export function profileProblem(profile: UserProfile): string | null {
  if (!parseMonthRange(profile.targetMonth)) return 'Choose a month such as "November 2026".';
  if (profile.mode === 'general') return null;
  if (!parseIsoDate(profile.birthDate)) return 'Add your birth date on the Profile tab.';
  if (profile.hasExactTime && !isValidBirthTime(profile.birthTime)) {
    return 'Add your birth time on the Profile tab, or mark it as unknown.';
  }
  return null;
}

/**
 * A stored profile from before onboarding existed has no `mode`. Such users are not asked the
 * onboarding questions again.
 */
export function isLegacyProfile(saved: unknown): boolean {
  return !!saved && typeof saved === 'object' && !Array.isArray(saved) && !('mode' in saved);
}

/** Comparison key for a source address: host without "www." plus path, without a trailing slash. */
export function sourceUrlKey(url: string): string {
  const u = new URL(url);
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

/** Turn what the user typed into a plain http(s) URL, or null. "site.com/page" gets https://. */
export function normalizeSourceUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !u.hostname.includes('.')) return null;
    u.hash = '';
    return u.href.length <= MAX_SOURCE_URL_LENGTH ? u.href : null;
  } catch {
    return null;
  }
}

export function reviveSourceSettings(saved: unknown): SourceSettings {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return DEFAULT_SOURCE_SETTINGS;
  const src = saved as Record<string, unknown>;
  const disabledCurated = Array.isArray(src.disabledCurated)
    ? src.disabledCurated.filter((id): id is string => typeof id === 'string').slice(0, 50)
    : [];
  const seen = new Set<string>();
  const user: UserSource[] = [];
  for (const item of Array.isArray(src.user) ? src.user : []) {
    if (!item || typeof item !== 'object') continue;
    const { id, url, active } = item as Record<string, unknown>;
    const normalized = typeof url === 'string' ? normalizeSourceUrl(url) : null;
    if (!normalized || typeof id !== 'string' || !id || id.length > 64) continue;
    const key = sourceUrlKey(normalized);
    if (seen.has(key) || user.length >= MAX_USER_SOURCES) continue;
    seen.add(key);
    user.push({ id, url: normalized, active: active !== false });
  }
  return { disabledCurated, user };
}

export function sourcesRequestBody(settings: SourceSettings, includeCurated = false) {
  return {
    disabledCurated: settings.disabledCurated,
    user: settings.user.map(({ id, url, active }) => ({ id, url, active })),
    includeCurated,
  };
}

const SOURCE_STATUSES = new Set(['used', 'no_forecast', 'failed']);
const SOURCE_ORIGINS = new Set(['curated', 'user', 'web']);
const EVIDENCE_MODES = new Set(['user', 'curated', 'web']);

export function parseSourceReport(input: unknown): SourceReport[] {
  if (!Array.isArray(input)) return [];
  const out: SourceReport[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.name !== 'string' ||
      typeof r.url !== 'string' ||
      !SOURCE_STATUSES.has(r.status as string) ||
      !SOURCE_ORIGINS.has(r.origin as string)
    )
      continue;
    out.push({
      id: r.id,
      name: r.name,
      url: r.url === '' || isHttpUrl(r.url) ? r.url : '',
      origin: r.origin as SourceReport['origin'],
      status: r.status as SourceReport['status'],
      reason: typeof r.reason === 'string' ? r.reason : undefined,
      documents: typeof r.documents === 'number' ? r.documents : 0,
    });
  }
  return out;
}

export function parseEvidence(input: unknown): ForecastEvidence | null {
  if (!input || typeof input !== 'object') return null;
  const e = input as Record<string, unknown>;
  if (!EVIDENCE_MODES.has(e.mode as string) || typeof e.gap !== 'boolean') return null;
  return { mode: e.mode as ForecastEvidence['mode'], gap: e.gap };
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
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    // Never pair the default birth place or chart with someone else's birth data.
    const src = saved as Record<string, unknown>;
    merged.birthPlace = isBirthPlace(src.birthPlace) ? src.birthPlace : undefined;
    merged.chart = isNatalChart(src.chart) ? src.chart : undefined;
  }
  // Profiles stored before onboarding existed have no mode: they hold birth data, so personal.
  if (merged.mode !== 'general' && merged.mode !== 'personal') merged.mode = defaults.mode;
  if (isLegacyProfile(saved)) merged.mode = 'personal';
  const context = cleanLifeContext(
    (saved as { lifeContext?: unknown } | null)?.lifeContext ?? merged.lifeContext,
    false
  );
  merged.lifeContext = Object.keys(context).length > 0 ? context : undefined;
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
  merged.focusAreas = storedFocusAreas(saved, defaults.focusAreas);
  if (!isValidBackendUrl(merged.backendUrl)) {
    merged.backendUrl = defaults.backendUrl;
  }
  return merged;
}
