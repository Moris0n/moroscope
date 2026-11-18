import { useEffect, useState } from 'react';

interface StorageKey {
  key: string;
  // Key used before the app was renamed; read once so existing data carries over.
  legacyKey: string;
}

const storageKey = (name: string): StorageKey => ({
  key: `moroscope_${name}_v1`,
  legacyKey: `celestialpulse_${name}_v1`,
});

export const STORAGE_KEYS = {
  PROFILE: storageKey('profile'),
  PROFILE_ID: storageKey('profile_id'),
  // 'sources' held the placeholder list of the first prototype; it is no longer read.
  SOURCE_SETTINGS: storageKey('source_settings'),
  ONBOARDED: storageKey('onboarded'),
};

export function readStoredString({ key, legacyKey }: StorageKey): string | null {
  try {
    return localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
  } catch {
    return null;
  }
}

export function writeStoredString({ key }: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable or full: the app keeps working from memory
  }
}

export function usePersistentState<T>(
  storage: StorageKey,
  fallback: T,
  revive: (saved: unknown) => T = (saved) => saved as T
) {
  const [value, setValue] = useState<T>(() => {
    const saved = readStoredString(storage);
    if (saved === null) return fallback;
    try {
      return revive(JSON.parse(saved));
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    writeStoredString(storage, JSON.stringify(value));
  }, [storage, value]);

  return [value, setValue] as const;
}
