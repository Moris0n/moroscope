import {
  ActivityCategory,
  DailyEnergyForecast,
  ElementType,
  EnergyDimension,
  HoroscopeSource,
  HourlyEnergySlot,
  ModalityType,
  ScheduledActivity,
  UserProfile,
  ZodiacSign,
} from '../types/astrology';
import {
  convertSourceWindowToUserTimezone,
  formatHourDecimal,
  formatTimezoneBadge,
  getTimezoneOffsetMinutes,
  normalizeSourceHourToUtc,
} from './timezoneEngine';

export const ZODIAC_SIGNS: ZodiacSign[] = [
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
];

export interface ZodiacMeta {
  sign: ZodiacSign;
  glyph: string;
  element: ElementType;
  modality: ModalityType;
  ruler: string;
  dateRange: string;
  keywords: string;
}

export const ZODIAC_METADATA: Record<ZodiacSign, ZodiacMeta> = {
  Aries: {
    sign: 'Aries',
    glyph: '♈',
    element: 'Fire',
    modality: 'Cardinal',
    ruler: 'Mars',
    dateRange: 'Mar 21 – Apr 19',
    keywords: 'Initiative · Velocity · Courage',
  },
  Taurus: {
    sign: 'Taurus',
    glyph: '♉',
    element: 'Earth',
    modality: 'Fixed',
    ruler: 'Venus',
    dateRange: 'Apr 20 – May 20',
    keywords: 'Stability · Craft · Resourcefulness',
  },
  Gemini: {
    sign: 'Gemini',
    glyph: '♊',
    element: 'Air',
    modality: 'Mutable',
    ruler: 'Mercury',
    dateRange: 'May 21 – Jun 20',
    keywords: 'Synthesis · Dialogue · Curiosity',
  },
  Cancer: {
    sign: 'Cancer',
    glyph: '♋',
    element: 'Water',
    modality: 'Cardinal',
    ruler: 'Moon',
    dateRange: 'Jun 21 – Jul 22',
    keywords: 'Intuition · Sanctuary · Emotional Depth',
  },
  Leo: {
    sign: 'Leo',
    glyph: '♌',
    element: 'Fire',
    modality: 'Fixed',
    ruler: 'Sun',
    dateRange: 'Jul 23 – Aug 22',
    keywords: 'Radiance · Leadership · Expression',
  },
  Virgo: {
    sign: 'Virgo',
    glyph: '♍',
    element: 'Earth',
    modality: 'Mutable',
    ruler: 'Mercury',
    dateRange: 'Aug 23 – Sep 22',
    keywords: 'Precision · Refinement · Discernment',
  },
  Libra: {
    sign: 'Libra',
    glyph: '♎',
    element: 'Air',
    modality: 'Cardinal',
    ruler: 'Venus',
    dateRange: 'Sep 23 – Oct 22',
    keywords: 'Equilibrium · Diplomacy · Aesthetics',
  },
  Scorpio: {
    sign: 'Scorpio',
    glyph: '♏',
    element: 'Water',
    modality: 'Fixed',
    ruler: 'Pluto & Mars',
    dateRange: 'Oct 23 – Nov 21',
    keywords: 'Intensity · Investigation · Alchemy',
  },
  Sagittarius: {
    sign: 'Sagittarius',
    glyph: '♐',
    element: 'Fire',
    modality: 'Mutable',
    ruler: 'Jupiter',
    dateRange: 'Nov 22 – Dec 21',
    keywords: 'Expansion · Philosophy · Horizon',
  },
  Capricorn: {
    sign: 'Capricorn',
    glyph: '♑',
    element: 'Earth',
    modality: 'Cardinal',
    ruler: 'Saturn',
    dateRange: 'Dec 22 – Jan 19',
    keywords: 'Architecture · Mastery · Endurance',
  },
  Aquarius: {
    sign: 'Aquarius',
    glyph: '♒',
    element: 'Air',
    modality: 'Fixed',
    ruler: 'Uranus & Saturn',
    dateRange: 'Jan 20 – Feb 18',
    keywords: 'Foresight · Systems · Originality',
  },
  Pisces: {
    sign: 'Pisces',
    glyph: '♓',
    element: 'Water',
    modality: 'Mutable',
    ruler: 'Neptune & Jupiter',
    dateRange: 'Feb 19 – Mar 20',
    keywords: 'Imagination · Empathy · Transcendence',
  },
};

export const CATEGORY_METADATA: Record<
  ActivityCategory,
  { label: string; shortLabel: string; colorClass: string; hex: string; description: string }
> = {
  career: {
    label: 'Career & New Projects',
    shortLabel: 'Career & Projects',
    colorClass: 'text-amber-300',
    hex: '#F59E0B',
    description: 'High-leverage project launches, deep execution, and pitch windows',
  },
  social: {
    label: 'Socializing & Romance',
    shortLabel: 'Socializing',
    colorClass: 'text-violet-300',
    hex: '#A78BFA',
    description: 'Collaborative synergy, networking, and relationship harmony',
  },
  hobbies: {
    label: 'Hobbies & Creative Craft',
    shortLabel: 'Hobbies & Craft',
    colorClass: 'text-cyan-300',
    hex: '#06B6D4',
    description: 'Artistic flow, skill exploration, and hands-on personal projects',
  },
  finance: {
    label: 'Financial Decisions & Caution',
    shortLabel: 'Financial Caution',
    colorClass: 'text-rose-300',
    hex: '#F43F5E',
    description: 'Contract reviews, investment risk windows, and void-of-course moon alerts',
  },
  wellness: {
    label: 'Physical Wellness & Vitality',
    shortLabel: 'Physical Wellness',
    colorClass: 'text-emerald-300',
    hex: '#10B981',
    description: 'Strength training, somatic movement, and metabolic peak hours',
  },
  mind: {
    label: 'Mind, Study & Spirit',
    shortLabel: 'Mind & Spirit',
    colorClass: 'text-indigo-300',
    hex: '#818CF8',
    description: 'Research, analytical synthesis, journaling, and meditation',
  },
  strategic: {
    label: 'Strategic Decisions',
    shortLabel: 'Strategic Planning',
    colorClass: 'text-sky-300',
    hex: '#38BDF8',
    description: 'Long-term roadmap alignment, negotiations, and architectural choices',
  },
  rest: {
    label: 'Rest & Recovery Windows',
    shortLabel: 'Rest Windows',
    colorClass: 'text-slate-300',
    hex: '#94A3B8',
    description: 'Low-stimulation decompression, digital detox, and lunar wind-down',
  },
};

export const ENERGY_DIMENSIONS_METADATA: Record<
  EnergyDimension,
  { label: string; shortLabel: string; color: string; description: string }
> = {
  mental: {
    label: 'Mental Focus',
    shortLabel: 'Mental',
    color: '#06B6D4', // Cyan
    description: 'Mercury-driven analytical clarity, problem-solving, and verbal articulation',
  },
  physical: {
    label: 'Physical Drive',
    shortLabel: 'Physical',
    color: '#F59E0B', // Amber Gold
    description: 'Mars & Solar stamina, kinetic output, and bodily resilience',
  },
  emotional: {
    label: 'Emotional Resonance',
    shortLabel: 'Emotional',
    color: '#8B5CF6', // Violet
    description: 'Lunar receptivity, relational attunement, and intuitive clarity',
  },
  creative: {
    label: 'Creative Spark',
    shortLabel: 'Creative',
    color: '#EC4899', // Pink/Magenta
    description: 'Venusian & Neptunian divergent thinking, ideation, and artistic flow',
  },
  social: {
    label: 'Social Vitality',
    shortLabel: 'Social',
    color: '#10B981', // Emerald
    description: 'Extraverted magnetism, group rapport, and persuasive warmth',
  },
  financialRisk: {
    label: 'Financial Caution Index',
    shortLabel: 'Financial Caution',
    color: '#F43F5E', // Rose Crimson
    description: 'Mercury/Venus friction or Void-of-Course Moon signalling prudence on spending',
  },
};

export const DEFAULT_SOURCES: HoroscopeSource[] = [
  {
    id: 'src-mountain-astrologer',
    name: 'The Mountain Astrologer Column',
    author: 'Tem Tarriktar & Editorial Desk',
    type: 'column',
    url: 'https://mountainastrologer.com',
    sourceTimezone: 'America/Los_Angeles',
    publishedHourNative: 6.0,
    weight: 1.8,
    isActive: true,
    sampleExtract:
      'Mercury forms an applying trine to the Midheaven at 09:30 PST while Mars activates the 3rd house of rapid execution; avoid speculative commitments during the late afternoon lunar square to Saturn between 15:00 and 17:30 PST.',
    focusDimensions: ['mental', 'financialRisk', 'physical'],
    lastCrawledUtc: '2026-10-17T10:00:00Z',
  },
  {
    id: 'src-astrology-zone',
    name: 'Astrology Zone Daily Dispatch',
    author: 'Susan Miller',
    type: 'column',
    url: 'https://astrologyzone.com',
    sourceTimezone: 'America/New_York',
    publishedHourNative: 7.5,
    weight: 1.5,
    isActive: true,
    sampleExtract:
      'Venus harmonizes with Jupiter in the morning Eastern window (10:00–12:30 EDT), creating an exceptional corridor for creative pitches, collaborative socializing, and high-visibility project launches.',
    focusDimensions: ['creative', 'social', 'emotional'],
    lastCrawledUtc: '2026-10-17T11:30:00Z',
  },
  {
    id: 'src-chani-ephemeris',
    name: 'Chani Transit & Embodied Notes',
    author: 'Chani Nicholas',
    type: 'blog',
    url: 'https://chaninicholas.com',
    sourceTimezone: 'America/Los_Angeles',
    publishedHourNative: 8.0,
    weight: 1.6,
    isActive: true,
    sampleExtract:
      'With the Moon transitioning through the angular houses today, protect your early evening hours (18:00–20:00 PDT) for somatic rest and creative hobbies rather than forcing transactional negotiations.',
    focusDimensions: ['emotional', 'creative', 'social'],
    lastCrawledUtc: '2026-10-17T12:15:00Z',
  },
  {
    id: 'src-london-evening-standard',
    name: 'Fleet Street Astral Chronicle',
    author: 'Patrick Arundell',
    type: 'newspaper',
    url: 'https://standard.co.uk/lifestyle/horoscopes',
    sourceTimezone: 'Europe/London',
    publishedHourNative: 5.0,
    weight: 1.2,
    isActive: true,
    sampleExtract:
      'Saturn steady in the solar chart rewards methodical architectural planning at 11:00 BST, though a brief Mercury sesquiquadrate at 16:00 BST calls for double-checking financial transfers and invoices.',
    focusDimensions: ['mental', 'financialRisk'],
    lastCrawledUtc: '2026-10-17T05:00:00Z',
  },
  {
    id: 'src-astrology-podcast-yt',
    name: 'The Astrology Podcast Transit Forecast',
    author: 'Chris Brennan & Austin Coppock (YouTube)',
    type: 'video',
    url: 'https://youtube.com/@TheAstrologyPodcast',
    sourceTimezone: 'America/Denver',
    publishedHourNative: 9.0,
    weight: 1.9,
    isActive: true,
    sampleExtract:
      'Hellenistic sect analysis highlights the Ascendant ruler gaining accidental dignity during midday solar elevation (12:00–14:30 MDT)—ideal for initiating complex technical or strategic initiatives.',
    focusDimensions: ['mental', 'physical', 'financialRisk'],
    lastCrawledUtc: '2026-10-17T15:00:00Z',
  },
  {
    id: 'src-sydney-southern-cross',
    name: 'Southern Cross Ephemeris & Skywatch',
    author: 'Kelly Surtees',
    type: 'blog',
    url: 'https://kellyastrology.com',
    sourceTimezone: 'Australia/Sydney',
    publishedHourNative: 7.0,
    weight: 1.3,
    isActive: false,
    sampleExtract:
      'Southern hemisphere transit check: Lunar trine to Venus peaks at 14:00 AEDT, supporting artistic hobbies, restorative movement, and warm community gatherings.',
    focusDimensions: ['physical', 'social', 'creative'],
    lastCrawledUtc: '2026-10-17T01:00:00Z',
  },
];

/**
 * Calculates Sun Sign from YYYY-MM-DD birth date.
 */
export function calculateSunSign(birthDate: string): ZodiacSign {
  const parts = birthDate.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[1]) || isNaN(parts[2])) return 'Libra';
  const month = parts[1];
  const day = parts[2];

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return 'Aries';
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return 'Taurus';
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return 'Gemini';
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return 'Cancer';
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return 'Leo';
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return 'Virgo';
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return 'Libra';
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return 'Scorpio';
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return 'Sagittarius';
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return 'Capricorn';
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return 'Aquarius';
  return 'Pisces';
}

/**
 * Calculates approximate Lunar Sign using sidereal/tropical lunar period (27.321661 days)
 * normalized to UTC via the user's birthTimezone.
 */
export function calculateMoonSign(
  birthDate: string,
  birthTime: string = '12:00',
  birthTimezone: string = 'UTC'
): ZodiacSign {
  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour, minute] = (birthTime || '12:00').split(':').map(Number);
  if (!year || !month || !day) return 'Taurus';

  const localHourDecimal = (hour || 12) + (minute || 0) / 60;
  const refDate = new Date(Date.UTC(year, month - 1, day, 12, 0));
  const { utcHour, dayShiftFromSourceToUtc } = normalizeSourceHourToUtc(
    localHourDecimal,
    birthTimezone,
    refDate
  );

  const utcTimestamp = Date.UTC(
    year,
    month - 1,
    day + dayShiftFromSourceToUtc,
    Math.floor(utcHour),
    Math.round((utcHour % 1) * 60)
  );

  // Reference new moon / Aries 0 deg epoch: Jan 6, 2000 18:14 UTC
  const epochMs = Date.UTC(2000, 0, 6, 18, 14, 0);
  const daysSinceEpoch = (utcTimestamp - epochMs) / (1000 * 60 * 60 * 24);
  const siderealPeriod = 27.321661;
  const normalizedCycle = (((daysSinceEpoch % siderealPeriod) + siderealPeriod) % siderealPeriod) / siderealPeriod;
  const signIndex = Math.floor(normalizedCycle * 12) % 12;
  return ZODIAC_SIGNS[signIndex];
}

/**
 * Calculates the Rising Sign (Ascendant) based on Sun Sign, exact Birth Time, and Birth Timezone.
 * At local sunrise (~06:00 local solar time), the Ascendant aligns with the Sun Sign,
 * advancing by 1 sign every 2 hours. We also account for timezone standardization vs local solar meridian.
 */
export function calculateRisingSign(
  birthDate: string,
  birthTime: string,
  birthTimezone: string = 'UTC'
): ZodiacSign {
  const sunSign = calculateSunSign(birthDate);
  const sunIndex = ZODIAC_SIGNS.indexOf(sunSign);
  const [hourStr, minStr] = (birthTime || '06:00').split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10) || 0;
  if (isNaN(hour)) return sunSign;

  // Normalize birth time with subtle seasonal equation-of-time adjustment
  const [, month, day] = birthDate.split('-').map(Number);
  const dayOfYear = (month || 1) * 30 + (day || 1);
  const seasonalEquationMins = Math.sin((dayOfYear / 365) * Math.PI * 2) * 14;
  const tzOffsetMins = getTimezoneOffsetMinutes(birthTimezone);
  // Subtle meridian correction
  const meridianCorrectionHours = ((tzOffsetMins % 60) + seasonalEquationMins) / 60;

  const totalHoursSinceSunrise = ((hour + minute / 60 + meridianCorrectionHours - 6) + 24) % 24;
  const signOffset = Math.floor(totalHoursSinceSunrise / 2);
  return ZODIAC_SIGNS[(sunIndex + signOffset) % 12];
}

/**
 * Determines which sign governs the user's recommendations:
 * Requirement: "Recommendations by the user's rising sign whereas If this is not available - then use sun sign"
 */
export function getEffectiveChartSign(profile: UserProfile): {
  sign: ZodiacSign;
  mode: 'Rising Sign (Ascendant)' | 'Sun Sign (Solar Fallback)';
  planetRuler: string;
} {
  if (profile.hasExactTime && profile.useRisingPrimary && profile.risingSign) {
    return {
      sign: profile.risingSign,
      mode: 'Rising Sign (Ascendant)',
      planetRuler: ZODIAC_METADATA[profile.risingSign].ruler,
    };
  }
  return {
    sign: profile.sunSign,
    mode: 'Sun Sign (Solar Fallback)',
    planetRuler: ZODIAC_METADATA[profile.sunSign].ruler,
  };
}

const PLANETARY_HOURS_RULERS = [
  'Saturn',
  'Jupiter',
  'Mars',
  'Sun',
  'Venus',
  'Mercury',
  'Moon',
];

const ASPECT_DESCRIPTIONS = [
  'Moon trine Natal Ascendant',
  'Mercury sextile Midheaven (10th House)',
  'Venus conjunct 5th House Cusp',
  'Mars trine Solar Ruler',
  'Jupiter sextile 2nd House of Resources',
  'Sun trine Natal Moon',
  'Mercury square Saturn (Caution Window)',
  'Moon Void-of-Course Transition',
  'Uranus sextile 11th House of Networks',
  'Neptune trine 9th House of Vision',
];

/**
 * Generates a 7-day astrological energy map and localized activity schedule.
 * All source extracts and planetary events are normalized to UTC first, then shifted to profile.operatingTimezone.
 */
export function generateWeeklyForecasts(
  profile: UserProfile,
  sources: HoroscopeSource[],
  baseDate: Date = new Date()
): DailyEnergyForecast[] {
  const activeSources = sources.filter((s) => s.isActive);
  const effectiveSources = activeSources.length > 0 ? activeSources : DEFAULT_SOURCES.slice(0, 2);

  const chartRuler = getEffectiveChartSign(profile);
  const primarySignIndex = ZODIAC_SIGNS.indexOf(chartRuler.sign);
  const sunSignIndex = ZODIAC_SIGNS.indexOf(profile.sunSign);
  const moonSignIndex = ZODIAC_SIGNS.indexOf(profile.moonSign);

  const elementBonus: Record<ElementType, { mental: number; physical: number; emotional: number; creative: number }> = {
    Fire: { mental: 4, physical: 12, emotional: 2, creative: 8 },
    Earth: { mental: 6, physical: 8, emotional: 4, creative: 4 },
    Air: { mental: 12, physical: 3, emotional: 4, creative: 9 },
    Water: { mental: 3, physical: 4, emotional: 13, creative: 11 },
  };
  const signElement = ZODIAC_METADATA[chartRuler.sign].element;
  const bonus = elementBonus[signElement];

  // Aggregate source weights per dimension
  const sourceDimensionWeights: Record<EnergyDimension, number> = {
    mental: 1,
    physical: 1,
    emotional: 1,
    creative: 1,
    social: 1,
    financialRisk: 1,
  };
  let totalWeight = 0;
  effectiveSources.forEach((src) => {
    totalWeight += src.weight;
    src.focusDimensions.forEach((dim) => {
      sourceDimensionWeights[dim] += src.weight * 0.25;
    });
  });

  const userTzOffsetHours = getTimezoneOffsetMinutes(profile.operatingTimezone, baseDate) / 60;
  const userTzBadge = formatTimezoneBadge(profile.operatingTimezone, baseDate);

  const lunarPhases = [
    { name: 'Waxing Crescent', illum: 34 },
    { name: 'First Quarter', illum: 50 },
    { name: 'Waxing Gibbous', illum: 68 },
    { name: 'Waxing Gibbous', illum: 81 },
    { name: 'Full Moon', illum: 98 },
    { name: 'Waning Gibbous', illum: 91 },
    { name: 'Waning Gibbous', illum: 78 },
  ];

  const forecasts: DailyEnergyForecast[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const targetDate = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const dateIso = targetDate.toISOString().split('T')[0];
    const dayLabel = targetDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    const dayShort = targetDate.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
    });

    const daySeed = (targetDate.getUTCDate() + primarySignIndex * 3 + dayOffset * 7) % 24;

    // Build 24 hours in user's local operating timezone, derived from normalized UTC ephemeris wave
    const hours: HourlyEnergySlot[] = [];
    for (let hourLocal = 0; hourLocal < 24; hourLocal++) {
      // Convert local hour back to normalized UTC hour so planetary transits happen at the exact same universal instant
      const hourUtc = (((hourLocal - Math.round(userTzOffsetHours)) % 24) + 24) % 24;

      // Circadian envelope in local time (so sleep/waking energy aligns with local sun elevation)
      const circadianWake =
        hourLocal >= 7 && hourLocal <= 21
          ? Math.sin(((hourLocal - 6) / 16) * Math.PI) * 28 + 52
          : 26 + Math.cos((hourLocal / 24) * Math.PI * 2) * 8;

      // Universal UTC planetary harmonic waves
      const mercuryWave = Math.sin(((hourUtc + daySeed) / 24) * Math.PI * 2 + primarySignIndex * 0.5) * 18;
      const marsWave = Math.cos(((hourUtc + dayOffset * 3) / 12) * Math.PI + sunSignIndex * 0.4) * 16;
      const venusWave = Math.sin(((hourUtc + moonSignIndex * 2) / 18) * Math.PI * 2) * 19;
      const moonWave = Math.cos(((hourUtc - daySeed) / 24) * Math.PI * 2 + moonSignIndex * 0.6) * 20;

      const clamp = (val: number) => Math.max(12, Math.min(98, Math.round(val)));

      const mental = clamp(
        (circadianWake * 0.85 + mercuryWave + bonus.mental) * Math.min(1.22, sourceDimensionWeights.mental * 0.65)
      );
      const physical = clamp(
        (circadianWake * 0.9 + marsWave + bonus.physical) * Math.min(1.22, sourceDimensionWeights.physical * 0.65)
      );
      const emotional = clamp(
        (54 + moonWave + bonus.emotional + (hourLocal >= 17 ? 10 : 0)) *
          Math.min(1.2, sourceDimensionWeights.emotional * 0.65)
      );
      const creative = clamp(
        (circadianWake * 0.78 + venusWave + moonWave * 0.4 + bonus.creative) *
          Math.min(1.22, sourceDimensionWeights.creative * 0.65)
      );
      const social = clamp(
        (hourLocal >= 11 && hourLocal <= 22 ? 66 : 34) + venusWave * 0.8 + marsWave * 0.3
      );

      // Financial Risk spikes during specific UTC friction windows (e.g. Mercury/Saturn or Void-of-Course Moon)
      const utcFrictionPeak = (14 + dayOffset * 2 + primarySignIndex) % 24;
      const distFromFriction = Math.min(
        Math.abs(hourUtc - utcFrictionPeak),
        24 - Math.abs(hourUtc - utcFrictionPeak)
      );
      const financialRisk = clamp(
        distFromFriction <= 2
          ? 78 + (2 - distFromFriction) * 9
          : 24 + Math.sin(((hourUtc + dayOffset) / 6) * Math.PI) * 14
      );

      const compositeVitality = clamp(
        mental * 0.24 +
          physical * 0.22 +
          creative * 0.22 +
          social * 0.18 +
          emotional * 0.14 -
          (financialRisk > 70 ? 8 : 0)
      );

      const planetIdx = (hourUtc + dayOffset * 3 + primarySignIndex) % PLANETARY_HOURS_RULERS.length;
      const aspectIdx = (Math.floor(hourUtc / 3) + dayOffset + primarySignIndex) % ASPECT_DESCRIPTIONS.length;

      hours.push({
        hourLocal,
        hourUtc,
        timeLabelLocal: `${String(hourLocal).padStart(2, '0')}:00`,
        timeLabelUtc: `${String(hourUtc).padStart(2, '0')}:00 UTC`,
        mental,
        physical,
        emotional,
        creative,
        social,
        financialRisk,
        compositeVitality,
        dominantAspect:
          financialRisk >= 75
            ? 'Moon square Saturn · Void-of-Course Caution'
            : ASPECT_DESCRIPTIONS[aspectIdx],
        activePlanet: PLANETARY_HOURS_RULERS[planetIdx],
      });
    }

    // Build personalized, timezone-normalized daily activities correlated with sources
    const src0 = effectiveSources[dayOffset % effectiveSources.length];
    const src1 = effectiveSources[(dayOffset + 1) % effectiveSources.length];
    const src2 = effectiveSources[(dayOffset + 2) % effectiveSources.length];

    const house10Sign = ZODIAC_SIGNS[(primarySignIndex + 9) % 12];
    const house5Sign = ZODIAC_SIGNS[(primarySignIndex + 4) % 12];
    const house2Sign = ZODIAC_SIGNS[(primarySignIndex + 1) % 12];
    const house11Sign = ZODIAC_SIGNS[(primarySignIndex + 10) % 12];

    const careerWin = convertSourceWindowToUserTimezone(
      9.0 + (dayOffset % 2) * 0.5,
      11.5 + (dayOffset % 2) * 0.5,
      src0.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const socialWin = convertSourceWindowToUserTimezone(
      12.5,
      14.5,
      src1.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const financeCautionWin = convertSourceWindowToUserTimezone(
      15.0 + (dayOffset % 3) * 0.5,
      17.0 + (dayOffset % 3) * 0.5,
      src0.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const hobbyWin = convertSourceWindowToUserTimezone(
      17.5,
      19.5,
      src2.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const wellnessWin = convertSourceWindowToUserTimezone(
      7.5,
      9.0,
      src1.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const strategicWin = convertSourceWindowToUserTimezone(
      11.0,
      12.5,
      src2.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const mindWin = convertSourceWindowToUserTimezone(
      19.5,
      21.0,
      src0.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const restWin = convertSourceWindowToUserTimezone(
      21.0,
      23.0,
      src2.sourceTimezone,
      profile.operatingTimezone,
      targetDate
    );

    const allDayActivities: ScheduledActivity[] = [
      {
        id: `act-${dateIso}-career`,
        category: 'career',
        title: `Initiate High-Impact Project & Architecture Work`,
        description: `With ${chartRuler.planetRuler} activating your 10th House (${house10Sign}), channel peak cognitive velocity into greenfield deliverables and core deep-work milestones.`,
        sourceNativeWindow: careerWin.sourceNativeWindow,
        utcWindow: careerWin.utcWindow,
        localWindow: careerWin.localWindow,
        localStartHour: careerWin.localStartHour,
        localEndHour: careerWin.localEndHour,
        dayShiftNote: careerWin.dayShiftNote,
        significance: 'favorable',
        cosmicReason: `Mercury trine 10th House Cusp (${house10Sign}) · Ruler of ${chartRuler.sign} (${chartRuler.mode})`,
        sourceAttribution: `${src0.name} (${src0.weight}x weight)`,
        energyDimension: 'mental',
        houseNumber: 10,
      },
      {
        id: `act-${dateIso}-finance`,
        category: 'finance',
        title: `Financial Caution Window — Defer Speculative Commitments`,
        description: `Avoid signing unreviewed contracts, impulsive asset trades, or non-essential purchases while the Moon forms an applying square across your 2nd House of resources (${house2Sign}).`,
        sourceNativeWindow: financeCautionWin.sourceNativeWindow,
        utcWindow: financeCautionWin.utcWindow,
        localWindow: financeCautionWin.localWindow,
        localStartHour: financeCautionWin.localStartHour,
        localEndHour: financeCautionWin.localEndHour,
        dayShiftNote: financeCautionWin.dayShiftNote,
        significance: 'caution',
        cosmicReason: `Lunar Square to 2nd House (${house2Sign}) · Void-of-Course Transition Alert`,
        sourceAttribution: `${src0.name} & ${src1.name}`,
        energyDimension: 'financialRisk',
        houseNumber: 2,
      },
      {
        id: `act-${dateIso}-social`,
        category: 'social',
        title: `Collaborative Alignment & High-Trust Socializing`,
        description: `Venus harmonizes with your 11th House of alliances (${house11Sign}). Prioritize warm outreach, team syncs, or romantic connection over solitary administration.`,
        sourceNativeWindow: socialWin.sourceNativeWindow,
        utcWindow: socialWin.utcWindow,
        localWindow: socialWin.localWindow,
        localStartHour: socialWin.localStartHour,
        localEndHour: socialWin.localEndHour,
        dayShiftNote: socialWin.dayShiftNote,
        significance: 'favorable',
        cosmicReason: `Venus sextile 11th House (${house11Sign}) for ${chartRuler.sign}`,
        sourceAttribution: `${src1.name} (${src1.weight}x weight)`,
        energyDimension: 'social',
        houseNumber: 11,
      },
      {
        id: `act-${dateIso}-hobbies`,
        category: 'hobbies',
        title: `Deep Creative Craft & Personal Hobby Immersion`,
        description: `5th House (${house5Sign}) creative currents peak during this window. Step away from inbox triage to work on music, design, writing, or tactile craftsmanship.`,
        sourceNativeWindow: hobbyWin.sourceNativeWindow,
        utcWindow: hobbyWin.utcWindow,
        localWindow: hobbyWin.localWindow,
        localStartHour: hobbyWin.localStartHour,
        localEndHour: hobbyWin.localEndHour,
        dayShiftNote: hobbyWin.dayShiftNote,
        significance: 'favorable',
        cosmicReason: `Neptune trine 5th House of Expression (${house5Sign})`,
        sourceAttribution: `${src2.name} (${src2.weight}x weight)`,
        energyDimension: 'creative',
        houseNumber: 5,
      },
      {
        id: `act-${dateIso}-wellness`,
        category: 'wellness',
        title: `Kinetic Movement & Somatic Conditioning`,
        description: `Mars lends clean physical stamina to your 1st and 6th houses. Ideal window for resistance training, brisk outdoor running, or mobility flows.`,
        sourceNativeWindow: wellnessWin.sourceNativeWindow,
        utcWindow: wellnessWin.utcWindow,
        localWindow: wellnessWin.localWindow,
        localStartHour: wellnessWin.localStartHour,
        localEndHour: wellnessWin.localEndHour,
        dayShiftNote: wellnessWin.dayShiftNote,
        significance: 'favorable',
        cosmicReason: `Mars sextile Ascendant Degree in ${chartRuler.sign}`,
        sourceAttribution: `${src1.name}`,
        energyDimension: 'physical',
        houseNumber: 6,
      },
      {
        id: `act-${dateIso}-strategic`,
        category: 'strategic',
        title: `Long-Horizon Strategic Roadmap & Systems Audit`,
        description: `Saturn stabilizes analytical judgment across your 9th House. Map quarterly priorities, refine resource allocation, and review architectural trade-offs.`,
        sourceNativeWindow: strategicWin.sourceNativeWindow,
        utcWindow: strategicWin.utcWindow,
        localWindow: strategicWin.localWindow,
        localStartHour: strategicWin.localStartHour,
        localEndHour: strategicWin.localEndHour,
        dayShiftNote: strategicWin.dayShiftNote,
        significance: 'favorable',
        cosmicReason: `Sun trine Saturn · 9th House Strategic Axis`,
        sourceAttribution: `${src2.name}`,
        energyDimension: 'mental',
        houseNumber: 9,
      },
      {
        id: `act-${dateIso}-mind`,
        category: 'mind',
        title: `Philosophical Study, Synthesis & Reflective Journaling`,
        description: `Lunar harmony with your natal ${profile.moonSign} Moon opens receptive pattern recognition. Ideal for reading, language study, or contemplative synthesis.`,
        sourceNativeWindow: mindWin.sourceNativeWindow,
        utcWindow: mindWin.utcWindow,
        localWindow: mindWin.localWindow,
        localStartHour: mindWin.localStartHour,
        localEndHour: mindWin.localEndHour,
        dayShiftNote: mindWin.dayShiftNote,
        significance: 'neutral',
        cosmicReason: `Moon trine Natal Moon in ${profile.moonSign}`,
        sourceAttribution: `${src0.name}`,
        energyDimension: 'emotional',
        houseNumber: 3,
      },
      {
        id: `act-${dateIso}-rest`,
        category: 'rest',
        title: `12th House Lunar Decompression & Digital Sunset`,
        description: `Allow nervous system recovery as planetary hours shift to lunar governance. Dim blue light and avoid high-friction debates.`,
        sourceNativeWindow: restWin.sourceNativeWindow,
        utcWindow: restWin.utcWindow,
        localWindow: restWin.localWindow,
        localStartHour: restWin.localStartHour,
        localEndHour: restWin.localEndHour,
        dayShiftNote: restWin.dayShiftNote,
        significance: 'neutral',
        cosmicReason: `12th House Sanctuary Transit · Lunar Wind-Down`,
        sourceAttribution: `${src2.name}`,
        energyDimension: 'emotional',
        houseNumber: 12,
      },
    ];

    // Filter to user's active categories (always keeping finance caution if selected or if high priority)
    const filteredActivities = allDayActivities
      .filter((a) => profile.activeCategories.includes(a.category))
      .sort((a, b) => a.localStartHour - b.localStartHour);

    const wakingHours = hours.filter((h) => h.hourLocal >= 8 && h.hourLocal <= 21);
    const overallScore = Math.round(
      wakingHours.reduce((acc, h) => acc + h.compositeVitality, 0) / wakingHours.length
    );

    const lunar = lunarPhases[dayOffset % lunarPhases.length];
    const consensusScore = Math.min(97, Math.round(78 + (totalWeight * 2.5) + (dayOffset % 5)));

    forecasts.push({
      dateIso,
      dayLabel,
      dayShort,
      lunarPhase: lunar.name,
      lunarIllumination: lunar.illum,
      overallScore,
      dominantTransit: `${chartRuler.planetRuler} trine ${house10Sign} Midheaven · Moon in ${ZODIAC_SIGNS[(moonSignIndex + dayOffset) % 12]}`,
      executiveSummary: `Synthesized across ${effectiveSources.length} active sources (weighted ${totalWeight.toFixed(1)}x) for your ${chartRuler.sign} ${chartRuler.mode}. Peak project velocity aligns with your ${careerWin.localWindow} window, while ${financeCautionWin.localWindow} warrants financial prudence as transits cross your 2nd House (${house2Sign}).`,
      consensusScore,
      timezoneAdjustmentNote: `Normalized ${effectiveSources.length} source feeds (${effectiveSources.map((s) => s.sourceTimezone.split('/').pop()).join(', ')}) → UTC → Projected to ${profile.operatingTimezone} (${userTzBadge}).`,
      chartRulerUsed: chartRuler,
      hours,
      activities: filteredActivities.length > 0 ? filteredActivities : allDayActivities.slice(0, 4),
    });
  }

  return forecasts;
}
