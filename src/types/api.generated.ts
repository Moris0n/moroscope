/* Generated from backend/app/models.py by 'npm run gen:types'. Do not edit. */

/**
 * Generated from backend/app/models.py. Do not edit.
 */
export interface MoroscopeApi {
  [k: string]: unknown;
}
/**
 * The days one source says an event is felt, around its date. The dates are not checked
 * against the text; a side is kept only when the source's quote names that day or counts days.
 *
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ActiveWindow".
 */
export interface ActiveWindow {
  end?: string;
  sourceUrl: string;
  start?: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ChartPlace".
 */
export interface ChartPlace {
  lat?: number;
  lon?: number;
  tz: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ChartRequestBody".
 */
export interface ChartRequestBody {
  birthDate: string;
  birthTime?: string;
  place: ChartPlace;
  timeKnown: boolean;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ChartResponse".
 */
export interface ChartResponse {
  moon:
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
  moonUncertain: boolean;
  rising?:
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
  sun:
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
  sunUncertain: boolean;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "CuratedSourceInfo".
 */
export interface CuratedSourceInfo {
  author: string;
  cadence: string;
  id: string;
  language: string;
  name: string;
  type: 'video' | 'website';
  url: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "CuratedSourcesResponse".
 */
export interface CuratedSourcesResponse {
  sources: CuratedSourceInfo[];
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ErrorResponse".
 */
export interface ErrorResponse {
  error: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "Evidence".
 */
export interface Evidence {
  gap: boolean;
  mode: 'user' | 'curated' | 'web';
}
/**
 * One event of the forecast. Dates, type, life areas and citations come from the extracted
 * events it is built from; only the title, summary and personal note are the Synthesizer's.
 *
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ForecastEvent".
 */
export interface ForecastEvent {
  activeWindows?: ActiveWindow[];
  aspect?:
    | 'newMoon'
    | 'fullMoon'
    | 'solarEclipse'
    | 'lunarEclipse'
    | 'ingress'
    | 'retrograde'
    | 'direct'
    | 'conjunction'
    | 'opposition'
    | 'square'
    | 'trine'
    | 'sextile';
  date: string;
  endDate?: string;
  house?: number;
  id: string;
  inFocus?: boolean;
  lifeAreas: (
    | 'career'
    | 'money'
    | 'love'
    | 'family'
    | 'health'
    | 'community'
    | 'communication'
    | 'learning'
    | 'creativity'
    | 'rest'
  )[];
  personalNote?: string;
  planets?: (
    | 'Sun'
    | 'Moon'
    | 'Mercury'
    | 'Venus'
    | 'Mars'
    | 'Jupiter'
    | 'Saturn'
    | 'Uranus'
    | 'Neptune'
    | 'Pluto'
    | 'Chiron'
    | 'North Node'
    | 'South Node'
  )[];
  sourceUrls: string[];
  summary: string;
  title: string;
  type: 'keyDate' | 'goodTime' | 'caution';
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ForecastResponse".
 */
export interface ForecastResponse {
  evidence: Evidence;
  profileId: string;
  result: MonthlyForecast;
  sources: SourceReport[];
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "MonthlyForecast".
 */
export interface MonthlyForecast {
  events: ForecastEvent[];
  icsContent: string;
  theme: string;
}
/**
 * What happened to one source while a forecast was generated.
 *
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "SourceReport".
 */
export interface SourceReport {
  documents: number;
  dropped?: number;
  events?: number;
  id: string;
  name: string;
  origin: 'curated' | 'user' | 'web';
  reason?: string;
  status: 'used' | 'no_forecast' | 'failed';
  url: string;
}
/**
 * A forecast for a sign: nothing else is asked, read or kept.
 *
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "GeneralProfile".
 */
export interface GeneralProfile {
  focusAreas?: (
    | 'career'
    | 'money'
    | 'love'
    | 'family'
    | 'health'
    | 'community'
    | 'communication'
    | 'learning'
    | 'creativity'
    | 'rest'
  )[];
  mode: 'general';
  sunSign:
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
  targetMonth: string;
}
/**
 * The user's situation. Every answer is optional. Reaches the Synthesizer as priorities, never the disk.
 *
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "LifeContext".
 */
export interface LifeContext {
  caringForParents?: boolean;
  goals?: string;
  healthFocus?: ('fitness' | 'sleep' | 'stress' | 'nutrition' | 'habit')[];
  kids?: ('none' | 'trying' | 'expecting' | 'under5' | 'age5to12' | 'teens' | 'adult')[];
  lookingForPartner?: boolean;
  moneyFocus?: 'saving' | 'bigPurchase' | 'investing' | 'debt';
  relationship?: 'single' | 'dating' | 'inRelationship' | 'married' | 'separated' | 'complicated';
  upcomingEvents?: UpcomingEvent[];
  work?: 'employed' | 'jobSeeking' | 'consideringChange' | 'selfEmployed' | 'student' | 'parentalLeave' | 'retired';
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "UpcomingEvent".
 */
export interface UpcomingEvent {
  date: string;
  label: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "PersonalProfile".
 */
export interface PersonalProfile {
  birthDate: string;
  birthLocation: string;
  birthTime?: string;
  birthTimezone: string;
  focusAreas?: (
    | 'career'
    | 'money'
    | 'love'
    | 'family'
    | 'health'
    | 'community'
    | 'communication'
    | 'learning'
    | 'creativity'
    | 'rest'
  )[];
  hasExactTime: boolean;
  lifeContext?: LifeContext;
  mode?: 'personal';
  moonSign:
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
  name: string;
  operatingTimezone: string;
  risingSign?:
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
  sunSign:
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
  targetMonth: string;
  useRisingPrimary: boolean;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "Place".
 */
export interface Place {
  country: string;
  label: string;
  lat: number;
  lon: number;
  name: string;
  region: string;
  tz: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "PlacesResponse".
 */
export interface PlacesResponse {
  results: Place[];
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ProfileSaveRequest".
 */
export interface ProfileSaveRequest {
  profile: GeneralProfile | PersonalProfile;
  profileId?: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "ProfileSaveResponse".
 */
export interface ProfileSaveResponse {
  profileId: string;
}
/**
 * The choices on the Sources tab. Active user sources are used instead of the default ones.
 *
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "SourcesRequest".
 */
export interface SourcesRequest {
  disabledCurated?: string[];
  includeCurated?: boolean;
  user?: UserSourceRequest[];
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "UserSourceRequest".
 */
export interface UserSourceRequest {
  active?: boolean;
  id?: string;
  url: string;
}
/**
 * This interface was referenced by `MoroscopeApi`'s JSON-Schema
 * via the `definition` "SynthesizeRequest".
 */
export interface SynthesizeRequest {
  customExcerpt?: string;
  profile: GeneralProfile | PersonalProfile;
  profileId?: string;
  sources?: SourcesRequest;
}
