import { CuratedSource } from '../types/astrology';
import { isHttpUrl } from '../utils/forecastShared';

function isCuratedSource(input: unknown): input is CuratedSource {
  if (!input || typeof input !== 'object') return false;
  const s = input as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.author === 'string' &&
    typeof s.cadence === 'string' &&
    (s.type === 'video' || s.type === 'website') &&
    isHttpUrl(s.url)
  );
}

export async function fetchCuratedSources(
  backendUrl: string,
  signal: AbortSignal
): Promise<CuratedSource[]> {
  const base = (backendUrl || '').replace(/\/+$/, '');
  const response = await fetch(`${base}/api/sources/curated`, { signal });
  if (!response.ok) {
    throw new Error(`The source list could not be loaded (HTTP ${response.status}).`);
  }
  const data = await response.json().catch(() => null);
  const sources: unknown[] = Array.isArray(data?.sources) ? data.sources : [];
  return sources.filter(isCuratedSource);
}
