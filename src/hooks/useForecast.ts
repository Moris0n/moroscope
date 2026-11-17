import { useEffect, useRef, useState } from 'react';
import {
  ForecastResult,
  LifePriority,
  UserProfile,
} from '../types/astrology';
import {
  ForecastPayload,
  connectionErrorMessage,
  requestForecast,
} from '../api/forecastApi';

export const FORECAST_STEPS_TOTAL = 4;

export interface StoredForecast {
  result: ForecastResult;
  rawJson: string;
  generatedAt: string;
  targetMonth: string;
  priorities: LifePriority[];
  profileId: string | null;
}

export function useForecast() {
  const [forecast, setForecast] = useState<StoredForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async (
    profile: UserProfile,
    profileId: string | null,
    customExcerpt?: string
  ): Promise<ForecastPayload | null> => {
    if (loading) return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setStep(0);
    setError(null);
    setForecast(null);

    try {
      const payload = await requestForecast(
        profile,
        profileId,
        customExcerpt,
        controller.signal,
        setStep
      );
      setForecast({
        result: payload.result,
        rawJson: JSON.stringify(payload, null, 2),
        generatedAt: new Date().toISOString(),
        targetMonth: profile.targetMonth,
        priorities: [...profile.priorities],
        profileId: payload.profileId,
      });
      setStep(FORECAST_STEPS_TOTAL + 1);
      return payload;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setError('Forecast request was cancelled.');
      } else if (err instanceof TypeError) {
        setError(connectionErrorMessage(profile));
      } else {
        setError(err?.message || 'Forecast pipeline failed.');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { forecast, loading, step, error, setError, generate };
}
