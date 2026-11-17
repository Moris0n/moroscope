import { ForecastResult, UserProfile } from '../types/astrology';
import { isValidForecastShape } from '../utils/forecastShared';
import { readForecastSseStream } from '../utils/forecastHelpers';

export const INVALID_BACKEND_URL_MESSAGE =
  'Invalid backend URL — use a plain http(s) origin without credentials, query, or fragment.';

const apiBase = (profile: UserProfile) =>
  (profile.backendUrl || '').replace(/\/+$/, '');

export const connectionErrorMessage = (profile: UserProfile) =>
  `Cannot connect to the forecast backend at ${
    profile.backendUrl || 'this origin'
  }. Make sure the API is running (npm run dev:api).`;

export interface ForecastPayload {
  result: ForecastResult;
  profileId: string | null;
}

export async function saveProfile(
  profile: UserProfile,
  profileId: string | null
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${apiBase(profile)}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, profileId: profileId ?? undefined }),
    });
  } catch {
    throw new Error(connectionErrorMessage(profile));
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Save failed (HTTP ${response.status}): ${data?.error || 'unknown error'}`
    );
  }
  return typeof data?.profileId === 'string' ? data.profileId : null;
}

export async function requestForecast(
  profile: UserProfile,
  profileId: string | null,
  customExcerpt: string | undefined,
  signal: AbortSignal,
  onProgress: (step: number) => void
): Promise<ForecastPayload> {
  const response = await fetch(`${apiBase(profile)}/api/horoscope/synthesize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    signal,
    body: JSON.stringify({
      profile,
      profileId: profileId ?? undefined,
      customExcerpt,
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  let payload: ForecastPayload;

  if (contentType.includes('text/event-stream')) {
    if (!response.body) throw new Error('Empty forecast stream.');
    if (!response.ok) {
      throw new Error(`Forecast request failed (HTTP ${response.status}).`);
    }
    payload = await readForecastSseStream(response.body, { onProgress });
  } else {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        data?.error || `Forecast request failed (HTTP ${response.status}).`
      );
    }
    payload = data;
  }

  if (!isValidForecastShape(payload?.result)) {
    throw new Error('Forecast response had an invalid result shape.');
  }
  return payload;
}
