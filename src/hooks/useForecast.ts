import { useEffect, useRef, useState } from 'react';
import {
  ForecastEvidence,
  ForecastResult,
  LifePriority,
  SourceReport,
} from '../types/astrology';
import {
  ForecastPayload,
  ForecastRequest,
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
  sources: SourceReport[];
  evidence: ForecastEvidence | null;
}

export function useForecast() {
  const [forecast, setForecast] = useState<StoredForecast | null>(null);
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
    setForecast(null);

    try {
      const payload = await requestForecast(request, controller.signal, setStep);
      setForecast({
        result: payload.result,
        rawJson: JSON.stringify(payload, null, 2),
        sources: payload.sources,
        evidence: payload.evidence,
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
