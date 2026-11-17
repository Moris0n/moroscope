import { useEffect, useState } from 'react';
import { UserProfile } from '../types/astrology';
import { fetchChart } from '../api/chartApi';
import { applyChart, chartBasis } from '../utils/chart';
import { isValidBackendUrl } from '../utils/forecastShared';

const DEBOUNCE_MS = 400;

export interface ChartStatus {
  state: 'idle' | 'loading' | 'error';
  error?: string;
  retry: () => void;
}

/**
 * Keeps the profile's signs in step with its birth data: whenever the birth data no longer
 * matches the cached chart, the chart is recalculated on the server.
 */
export function useNatalChart(
  profile: UserProfile,
  setProfile: (update: (prev: UserProfile) => UserProfile) => void
): ChartStatus {
  const [status, setStatus] = useState<Omit<ChartStatus, 'retry'>>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const basis = chartBasis(profile);
  const stale = basis !== null && profile.chart?.basis !== basis;
  const { backendUrl } = profile;

  useEffect(() => {
    if (!stale || basis === null || !isValidBackendUrl(backendUrl)) {
      setStatus({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    setStatus({ state: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const chart = await fetchChart(backendUrl, basis, controller.signal);
        setProfile((prev) =>
          chartBasis(prev) === basis ? applyChart(prev, chart, basis) : prev
        );
      } catch (err: any) {
        if (controller.signal.aborted) return;
        setStatus({
          state: 'error',
          error:
            err instanceof TypeError
              ? 'Cannot reach the server to calculate your signs. The signs shown may not match your birth data.'
              : err?.message || 'Chart calculation failed.',
        });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [basis, stale, backendUrl, attempt, setProfile]);

  return { ...status, retry: () => setAttempt((n) => n + 1) };
}
