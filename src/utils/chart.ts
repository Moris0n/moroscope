import { NatalChart, UserProfile } from '../types/astrology';
import { isValidBirthTime, parseIsoDate } from './forecastShared';

export const MIN_BIRTH_YEAR = 1900;
export const MAX_BIRTH_YEAR = 2050;

export type ChartResponse = Omit<NatalChart, 'basis'>;

/**
 * The /api/chart request body for a profile, as a string. It doubles as the cache key that
 * tells whether a stored chart still matches the birth data. Null if the data is incomplete.
 */
export function chartBasis(profile: UserProfile): string | null {
  const date = parseIsoDate(profile.birthDate);
  if (!date || date.year < MIN_BIRTH_YEAR || date.year > MAX_BIRTH_YEAR) return null;
  if (profile.hasExactTime && !isValidBirthTime(profile.birthTime)) return null;
  const place = profile.birthPlace;
  const hasCoordinates = !!place && place.tz === profile.birthTimezone;
  return JSON.stringify({
    birthDate: profile.birthDate,
    birthTime: profile.hasExactTime ? profile.birthTime : undefined,
    timeKnown: profile.hasExactTime,
    place: {
      tz: profile.birthTimezone,
      lat: hasCoordinates ? place.lat : undefined,
      lon: hasCoordinates ? place.lon : undefined,
    },
  });
}

/** Replace the profile's signs (including manual overrides) with a freshly calculated chart. */
export function applyChart(
  profile: UserProfile,
  chart: ChartResponse,
  basis: string
): UserProfile {
  return {
    ...profile,
    sunSign: chart.sun,
    moonSign: chart.moon,
    risingSign: chart.rising,
    useRisingPrimary: chart.rising
      ? profile.risingSign
        ? profile.useRisingPrimary
        : true
      : false,
    chart: { ...chart, basis },
  };
}
