import { BirthPlace } from '../types/astrology';
import { isBirthPlace, isChartResponse } from '../utils/forecastShared';
import { ChartResponse } from '../utils/chart';

const apiBase = (backendUrl: string) => (backendUrl || '').replace(/\/+$/, '');

export async function fetchChart(
  backendUrl: string,
  body: string,
  signal: AbortSignal
): Promise<ChartResponse> {
  const response = await fetch(`${apiBase(backendUrl)}/api/chart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Chart calculation failed (HTTP ${response.status}).`);
  }
  if (!isChartResponse(data)) {
    throw new Error('Chart response had an invalid shape.');
  }
  return data;
}

export async function searchPlaces(
  backendUrl: string,
  query: string,
  signal: AbortSignal
): Promise<BirthPlace[]> {
  const response = await fetch(
    `${apiBase(backendUrl)}/api/places?q=${encodeURIComponent(query)}`,
    { signal }
  );
  if (!response.ok) {
    throw new Error(`Place search failed (HTTP ${response.status}).`);
  }
  const data = await response.json().catch(() => null);
  const results: unknown[] = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter(isBirthPlace)
    .map(({ label, lat, lon, tz }) => ({ label, lat, lon, tz }));
}
