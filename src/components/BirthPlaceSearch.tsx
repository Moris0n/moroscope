import React, { useEffect, useId, useState } from 'react';
import { BirthPlace } from '../types/astrology';
import { searchPlaces } from '../api/chartApi';

interface BirthPlaceSearchProps {
  value: string;
  backendUrl: string;
  onSelect: (place: BirthPlace) => void;
}

const DEBOUNCE_MS = 250;

export const BirthPlaceSearch: React.FC<BirthPlaceSearchProps> = ({
  value,
  backendUrl,
  onSelect,
}) => {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<BirthPlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searching = query !== value && query.trim().length >= 2;

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    if (!searching) {
      setResults(null);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setResults(await searchPlaces(backendUrl, query, controller.signal));
        setActiveIndex(0);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching, backendUrl]);

  const choose = (place: BirthPlace) => {
    setResults(null);
    setQuery(place.label);
    onSelect(place);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery(value);
    } else if (results?.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(results[activeIndex]);
      }
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={!!results}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setQuery(value)}
        placeholder="Search for a city"
        className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
      />
      {searching && (results || failed) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl bg-[#10172A] border border-slate-700 shadow-xl"
        >
          {failed ? (
            <li className="px-3.5 py-2.5 text-xs text-rose-300">
              Place search is unavailable. Check that the server is running.
            </li>
          ) : results && results.length === 0 ? (
            <li className="px-3.5 py-2.5 text-xs text-slate-400">
              No city found. Try the nearest larger city.
            </li>
          ) : (
            results?.map((place, index) => (
              <li
                key={`${place.label}|${place.lat}|${place.lon}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(place);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`px-3.5 py-2.5 text-xs cursor-pointer ${
                  index === activeIndex
                    ? 'bg-amber-500/15 text-amber-100'
                    : 'text-slate-200'
                }`}
              >
                {place.label}
                <span className="ml-2 font-mono text-[10px] text-slate-500">
                  {place.tz}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};
