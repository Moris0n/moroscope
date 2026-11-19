import type {
  ChartResponse,
  CuratedSourceInfo,
  Evidence,
  ForecastEvent,
  LifeContext,
  MonthlyForecast,
  PersonalProfile,
  SourceReport,
  SynthesizeRequest,
  UpcomingEvent,
} from './api.generated';

// The shapes that travel between the browser and the server are generated from the backend models
// (`npm run gen:types`). This file names them for the app and adds what exists on the device only.
export type { ForecastEvent, LifeContext, MonthlyForecast, SourceReport, UpcomingEvent };

export type ZodiacSign = ChartResponse['sun'];

// The one taxonomy: profile focus, event tags, map rows and calendar text.
export type LifeArea = ForecastEvent['lifeAreas'][number];
export type EventType = ForecastEvent['type'];

export type ElementType = 'Fire' | 'Earth' | 'Air' | 'Water';
export type ModalityType = 'Cardinal' | 'Fixed' | 'Mutable';

export type SourceType = 'newspaper' | 'column' | 'blog' | 'video';

// Kept under their earlier names in the app.
export type TransitEvent = ForecastEvent;
export type ForecastResult = MonthlyForecast;

export interface BirthPlace {
  label: string;
  lat: number;
  lon: number;
  tz: string; // IANA timezone of the place
}

// The last server-calculated chart, with the birth data it was calculated from.
export type NatalChart = ChartResponse & { basis: string };

export type ProfileMode = 'general' | 'personal';

export type RelationshipStatus = NonNullable<LifeContext['relationship']>;
export type WorkStatus = NonNullable<LifeContext['work']>;
export type MoneyFocus = NonNullable<LifeContext['moneyFocus']>;
export type KidsStage = NonNullable<LifeContext['kids']>[number];
export type HealthFocus = NonNullable<LifeContext['healthFocus']>[number];

// What the server accepts as a profile: a general one (sign only) or a personal one.
export type ProfileRequest = SynthesizeRequest['profile'];

type PersonalFields = Required<Omit<PersonalProfile, 'mode' | 'lifeContext' | 'risingSign'>>;

// The profile as kept on the device: the fields the server knows, plus device-only ones.
export interface UserProfile extends PersonalFields {
  // 'general': only a sign is known (kept in sunSign). 'personal': birth data and life context.
  mode: ProfileMode;
  // Every answer is optional. Sent to the forecast model in personal mode; never stored on the server.
  lifeContext?: LifeContext;
  risingSign?: ZodiacSign;
  birthPlace?: BirthPlace; // chosen from the place search; needed for the Rising sign
  chart?: NatalChart; // last server-calculated chart; the signs may be manual overrides
  backendUrl: string;
}

export type CuratedSource = CuratedSourceInfo;

export interface UserSource {
  id: string;
  url: string;
  active: boolean;
}

// The user's choices on the Sources tab. Active user sources are used instead of the default ones.
export interface SourceSettings {
  disabledCurated: string[];
  user: UserSource[];
}

export type SourceStatus = SourceReport['status'];

export type ForecastEvidence = Evidence;

// One generated forecast as kept on the device, with what it was made for.
export interface StoredForecast {
  result: ForecastResult;
  generatedAt: string;
  targetMonth: string;
  focusAreas: LifeArea[];
  sign: ZodiacSign; // the sign the sources were read for
  mode: ProfileMode;
  profileId: string | null;
  sources: SourceReport[];
  evidence: ForecastEvidence | null;
}

// Everything below is only used by the hidden energy charts (synthetic data).
export type ActivityCategory =
  | 'career'
  | 'social'
  | 'hobbies'
  | 'finance'
  | 'wellness'
  | 'mind'
  | 'strategic'
  | 'rest';

export type EnergyDimension =
  | 'mental'
  | 'physical'
  | 'emotional'
  | 'creative'
  | 'social'
  | 'financialRisk';

export interface HoroscopeSource {
  id: string;
  name: string;
  author: string;
  type: SourceType;
  url: string;
  sourceTimezone: string; // Native timezone of the publication/creator
  publishedHourNative: number; // e.g., 8.0 for 08:00 in source's timezone
  weight: number; // 0.5 to 2.0
  isActive: boolean;
  sampleExtract: string;
  focusDimensions: EnergyDimension[];
  lastCrawledUtc: string;
  isCommunitySuggested?: boolean;
}

export interface ScheduledActivity {
  id: string;
  category: ActivityCategory;
  title: string;
  description: string;
  sourceNativeWindow: string; // e.g. "09:00 - 11:00 America/New_York"
  utcWindow: string; // Normalized default timezone: e.g. "13:00 - 15:00 UTC"
  localWindow: string; // Adjusted to user operatingTimezone: e.g. "14:00 - 16:00 BST"
  localStartHour: number; // 0-23
  localEndHour: number; // 0-23
  dayShiftNote?: string; // e.g. "Shifted +1 day from source TZ"
  significance: 'favorable' | 'caution' | 'neutral';
  cosmicReason: string;
  sourceAttribution: string;
  energyDimension: EnergyDimension;
  houseNumber: number;
  completed?: boolean;
  isUserCustom?: boolean;
}

export interface HourlyEnergySlot {
  hourLocal: number; // 0..23 in user's operating timezone
  hourUtc: number; // 0..23 in normalized UTC
  timeLabelLocal: string; // "00:00", "01:00", ...
  timeLabelUtc: string; // "04:00 UTC"
  mental: number; // 0..100
  physical: number; // 0..100
  emotional: number; // 0..100
  creative: number; // 0..100
  social: number; // 0..100
  financialRisk: number; // 0..100 (Higher means higher risk / caution advised)
  compositeVitality: number; // 0..100
  dominantAspect: string;
  activePlanet: string;
}

export interface DailyEnergyForecast {
  dateIso: string; // YYYY-MM-DD in user's operating timezone
  dayLabel: string; // e.g. "Saturday, Oct 17"
  dayShort: string; // e.g. "Sat 17"
  lunarPhase: string;
  lunarIllumination: number;
  overallScore: number;
  dominantTransit: string;
  executiveSummary: string;
  consensusScore: number;
  timezoneAdjustmentNote: string;
  chartRulerUsed: {
    sign: ZodiacSign;
    mode: 'Rising Sign (Ascendant)' | 'Sun Sign (Solar Fallback)';
    planetRuler: string;
  };
  hours: HourlyEnergySlot[];
  activities: ScheduledActivity[];
}
