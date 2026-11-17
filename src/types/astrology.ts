export type ZodiacSign =
  | 'Aries'
  | 'Taurus'
  | 'Gemini'
  | 'Cancer'
  | 'Leo'
  | 'Virgo'
  | 'Libra'
  | 'Scorpio'
  | 'Sagittarius'
  | 'Capricorn'
  | 'Aquarius'
  | 'Pisces';

export type ElementType = 'Fire' | 'Earth' | 'Air' | 'Water';
export type ModalityType = 'Cardinal' | 'Fixed' | 'Mutable';

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

export type SourceType = 'newspaper' | 'column' | 'blog' | 'video';

export type LifePriority =
  | 'careerTransition'
  | 'contractNegotiations'
  | 'datingRomance'
  | 'healthHabits'
  | 'financialPlanning';

export type ImpactType = 'Opportunity' | 'Caution' | 'Milestone';

export interface TransitEvent {
  date: string;
  end_date?: string;
  title: string;
  impact_type: ImpactType;
  summary: string;
  topics: LifePriority[];
  source_urls: string[];
}

export interface ForecastResult {
  overall_theme: string;
  events: TransitEvent[];
  ics_content: string;
}

export interface BirthPlace {
  label: string;
  lat: number;
  lon: number;
  tz: string; // IANA timezone of the place
}

export interface NatalChart {
  sun: ZodiacSign;
  moon: ZodiacSign;
  rising?: ZodiacSign; // only with a known birth time and a birth place
  sunUncertain: boolean; // birth time unknown and the sign changed that day
  moonUncertain: boolean;
  basis: string; // the birth data this chart was calculated from
}

export interface UserProfile {
  name: string;
  birthDate: string; // YYYY-MM-DD
  birthTime: string; // HH:mm
  hasExactTime: boolean;
  birthLocation: string;
  birthPlace?: BirthPlace; // chosen from the place search; needed for the Rising sign
  birthTimezone: string; // IANA timezone for birth calculation
  operatingTimezone: string; // IANA timezone for daily schedule & transits
  sunSign: ZodiacSign;
  moonSign: ZodiacSign;
  risingSign?: ZodiacSign;
  chart?: NatalChart; // last server-calculated chart; the signs above may be manual overrides
  useRisingPrimary: boolean; // When true and hasExactTime is true, Rising sign rules chart
  activeCategories: ActivityCategory[];
  targetMonth: string;
  priorities: LifePriority[];
  backendUrl: string;
}

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
