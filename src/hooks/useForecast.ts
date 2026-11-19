import { useEffect, useRef, useState } from 'react';
import { StoredForecast } from '../types/astrology';
import {
  ForecastPayload,
  ForecastRequest,
  connectionErrorMessage,
  requestForecast,
} from '../api/forecastApi';
import { primarySign } from '../utils/forecastShared';
import {
  ForecastRecord,
  forecastForMonth,
  reviveForecastRecords,
  withForecast,
} from '../utils/forecastStore';
import { STORAGE_KEYS, usePersistentState } from '../utils/storage';

export type { StoredForecast };

export const FORECAST_STEPS_TOTAL = 4;

const NO_RECORDS: ForecastRecord[] = [];

/**
 * The forecast of `targetMonth` and the request that makes a new one. The latest forecast of each
 * month is kept on the device, so it is still there after a reload and without a connection.
 */
export function useForecast(targetMonth: string) {
  const [records, setRecords] = usePersistentState<ForecastRecord[]>(
    STORAGE_KEYS.FORECASTS,
    NO_RECORDS,
    reviveForecastRecords
  );
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async (request: ForecastRequest): Promise<ForecastPayload | null> => {
    const { profile } = request;
    if (loading) return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setStep(0);
    setError(null);

    try {
      const payload = await requestForecast(request, controller.signal, setStep);
      const forecast: StoredForecast = {
        result: payload.result,
        sources: payload.sources,
        evidence: payload.evidence,
        generatedAt: new Date().toISOString(),
        targetMonth: profile.targetMonth,
        focusAreas: [...profile.focusAreas],
        sign: primarySign(profile).sign,
        mode: profile.mode,
        profileId: payload.profileId,
      };
      // A failed request leaves the stored forecast of the month as it was.
      setRecords((prev) => withForecast(prev, forecast));
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

  return {
    forecast: forecastForMonth(records, targetMonth),
    loading,
    step,
    error,
    setError,
    generate,
    clearForecasts: () => setRecords(NO_RECORDS),
  };
}
