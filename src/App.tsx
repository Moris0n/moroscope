/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  Clipboard,
  Download,
  Globe,
  Radio,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import {
  DailyEnergyForecast,
  ForecastResult,
  HoroscopeSource,
  LifePriority,
  ScheduledActivity,
  UserProfile,
} from './types/astrology';
import {
  DEFAULT_SOURCES,
  ENERGY_DIMENSIONS_METADATA,
  ZODIAC_METADATA,
  calculateMoonSign,
  calculateRisingSign,
  calculateSunSign,
  generateWeeklyForecasts,
  getEffectiveChartSign,
} from './utils/astrologyEngine';
import {
  TIMEZONE_OPTIONS,
  detectLocalTimezone,
  formatTimezoneBadge,
} from './utils/timezoneEngine';
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_TARGET_MONTH,
  PRIORITY_LABELS,
  isValidBackendUrl,
  isValidForecastShape,
  mergeProfileWithDefaults,
} from './utils/forecastShared';
import {
  copyToClipboard,
  downloadIcs,
  impactBadgeClasses,
  readForecastSseStream,
} from './utils/forecastHelpers';
import { AgentProgress } from './components/AgentProgress';
import { EnergyWaveChart } from './components/EnergyWaveChart';
import { TransitHeatmapMatrix } from './components/TransitHeatmapMatrix';
import { ActivityScheduler } from './components/ActivityScheduler';
import { SourcesManager } from './components/SourcesManager';
import { NatalProfilePanel } from './components/NatalProfilePanel';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

type ActiveTab = 'dashboard' | 'energymap' | 'sources' | 'profile';

const STORAGE_KEYS = {
  PROFILE: 'celestialpulse_profile_v1',
  PROFILE_ID: 'celestialpulse_profile_id_v1',
  SOURCES: 'celestialpulse_sources_v1',
  CUSTOM_ACTIVITIES: 'celestialpulse_custom_acts_v1',
  COMPLETED_IDS: 'celestialpulse_completed_v1',
};

const FORECAST_STEPS_TOTAL = 4;

const INITIAL_PROFILE: UserProfile = {
  name: 'Elena Vance',
  birthDate: '1994-10-17',
  birthTime: '08:45',
  hasExactTime: true,
  birthLocation: 'New York, NY',
  birthTimezone: 'America/New_York',
  operatingTimezone: detectLocalTimezone(),
  sunSign: calculateSunSign('1994-10-17'),
  moonSign: calculateMoonSign('1994-10-17', '08:45', 'America/New_York'),
  risingSign: calculateRisingSign('1994-10-17', '08:45', 'America/New_York'),
  useRisingPrimary: true,
  activeCategories: [
    'career',
    'finance',
    'social',
    'hobbies',
    'wellness',
    'strategic',
    'mind',
    'rest',
  ],
  targetMonth: DEFAULT_TARGET_MONTH,
  priorities: ['careerTransition', 'financialPlanning'],
  backendUrl: DEFAULT_BACKEND_URL,
};

interface StoredForecast {
  result: ForecastResult;
  rawJson: string;
  generatedAt: string;
  targetMonth: string;
  priorities: LifePriority[];
  profileId: string | null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);

  const [profile, setProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (saved) {
        return mergeProfileWithDefaults(INITIAL_PROFILE, JSON.parse(saved));
      }
    } catch {
      // ignore storage error
    }
    return INITIAL_PROFILE;
  });

  const [profileId, setProfileId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.PROFILE_ID);
    } catch {
      return null;
    }
  });

  const [sources, setSources] = useState<HoroscopeSource[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SOURCES);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return DEFAULT_SOURCES;
  });

  const [customActivitiesByDate, setCustomActivitiesByDate] = useState<
    Record<string, ScheduledActivity[]>
  >(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_ACTIVITIES);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {};
  });

  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.COMPLETED_IDS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  });

  const [forecast, setForecast] = useState<StoredForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastStep, setForecastStep] = useState(0);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [saveProfileStatus, setSaveProfileStatus] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const savedProfileRef = useRef<UserProfile | null>(null);
  const profileDirty = savedProfileRef.current !== profile;
  const [synthesisToast, setSynthesisToast] = useState<string | null>(null);
  const forecastAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
    } catch {
      // ignore
    }
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(sources));
    } catch {
      // ignore
    }
  }, [sources]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.CUSTOM_ACTIVITIES,
        JSON.stringify(customActivitiesByDate)
      );
    } catch {
      // ignore
    }
  }, [customActivitiesByDate]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.COMPLETED_IDS,
        JSON.stringify(completedIds)
      );
    } catch {
      // ignore
    }
  }, [completedIds]);

  useEffect(() => {
    return () => {
      forecastAbortRef.current?.abort();
    };
  }, []);

  // Generate 7-day astrological forecasts & energy maps
  const weeklyForecasts: DailyEnergyForecast[] = useMemo(() => {
    return generateWeeklyForecasts(profile, sources);
  }, [profile, sources]);

  const currentForecast =
    weeklyForecasts[selectedDayIndex] || weeklyForecasts[0];
  const effectiveChart = getEffectiveChartSign(profile);
  const primarySignMeta = ZODIAC_METADATA[effectiveChart.sign];

  const handleToggleSource = (id: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s))
    );
  };

  const handleChangeSourceWeight = (id: string, weight: number) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, weight } : s))
    );
  };

  const handleAddSuggestedSource = (newSource: HoroscopeSource) => {
    setSources((prev) => [newSource, ...prev]);
    setSynthesisToast(
      `Added "${newSource.name}" (${newSource.sourceTimezone} → UTC → ${profile.operatingTimezone})`
    );
    setTimeout(() => setSynthesisToast(null), 4000);
  };

  const handleToggleComplete = (actId: string) => {
    setCompletedIds((prev) =>
      prev.includes(actId) ? prev.filter((id) => id !== actId) : [...prev, actId]
    );
  };

  const handleAddCustomActivity = (activity: ScheduledActivity) => {
    const dateKey = currentForecast.dateIso;
    setCustomActivitiesByDate((prev) => ({
      ...prev,
      [dateKey]: [...(prev[dateKey] || []), activity],
    }));
  };

  // Deterministic Local Extraction for Custom Excerpt or Refresh
  // Fallback to local deterministic extraction when offline or serverless
  const apiBase = () => (profile.backendUrl || '').replace(/\/+$/, '');

  const connectionErrorMessage = () =>
    `Cannot connect to the forecast backend at ${
      profile.backendUrl || 'same origin'
    }. Ensure your server is running with CORS enabled.`;

  const updateProfile = (updated: UserProfile) => {
    setProfile(updated);
  };

  const handleSaveProfile = async () => {
    if (isSavingProfile) return;
    if (!isValidBackendUrl(profile.backendUrl)) {
      setSaveProfileStatus(
        'Invalid backend URL — use a plain http(s) origin without credentials, query, or fragment.'
      );
      return;
    }
    setIsSavingProfile(true);
    setSaveProfileStatus(null);
    const savedSnapshot = profile;
    try {
      const response = await fetch(`${apiBase()}/api/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: savedSnapshot,
          profileId: profileId ?? undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setSaveProfileStatus(
          `Save failed (HTTP ${response.status}): ${data?.error || 'unknown error'}`
        );
        return;
      }
      if (data?.profileId) {
        setProfileId(data.profileId);
        try {
          localStorage.setItem(STORAGE_KEYS.PROFILE_ID, data.profileId);
        } catch {
          // ignore
        }
      }
      savedProfileRef.current = savedSnapshot;
      setSaveProfileStatus(`Profile saved (ID ${data?.profileId || 'n/a'}).`);
    } catch {
      setSaveProfileStatus(connectionErrorMessage());
    } finally {
      setIsSavingProfile(false);
    }
  };

  const triggerForecast = async (customExcerpt?: string) => {
    if (forecastLoading) return;
    if (!isValidBackendUrl(profile.backendUrl)) {
      setActiveTab('dashboard');
      setForecastError(
        'Invalid backend URL — use a plain http(s) origin without credentials, query, or fragment.'
      );
      return;
    }
    setActiveTab('dashboard');
    forecastAbortRef.current?.abort();
    const controller = new AbortController();
    forecastAbortRef.current = controller;

    setForecastLoading(true);
    setForecastStep(0);
    setForecastError(null);
    setSynthesisToast(null);
    setForecast(null);

    try {
      const response = await fetch(`${apiBase()}/api/horoscope/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
        body: JSON.stringify({
          profile,
          profileId: profileId ?? undefined,
          customExcerpt,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      let payload: { result: ForecastResult; profileId: string | null };

      if (contentType.includes('text/event-stream')) {
        if (!response.body) {
          throw new Error('Empty forecast stream.');
        }
        if (!response.ok) {
          throw new Error(`Forecast request failed (HTTP ${response.status}).`);
        }
        payload = await readForecastSseStream(response.body, {
          onProgress: (step) => setForecastStep(step),
        });
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

      const result = payload.result;
      setForecast({
        result,
        rawJson: JSON.stringify(payload, null, 2),
        generatedAt: new Date().toISOString(),
        targetMonth: profile.targetMonth,
        priorities: [...profile.priorities],
        profileId: payload.profileId,
      });
      if (payload.profileId && payload.profileId !== profileId) {
        setProfileId(payload.profileId);
        try {
          localStorage.setItem(STORAGE_KEYS.PROFILE_ID, payload.profileId);
        } catch {
          // ignore
        }
      }
      setForecastStep(FORECAST_STEPS_TOTAL + 1);
      setSynthesisToast(
        `Generated ${result.events.length} source-backed events for ${profile.targetMonth}`
      );
      setTimeout(() => setSynthesisToast(null), 5000);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setForecastError('Forecast request was cancelled.');
      } else if (err instanceof TypeError) {
        setForecastError(connectionErrorMessage());
      } else {
        setForecastError(err?.message || 'Forecast pipeline failed.');
      }
    } finally {
      setForecastLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080B14] text-slate-100 pb-24 md:pb-12">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#080B14]/90 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 h-14">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('dashboard');
            }}
            className="text-lg font-bold tracking-tight text-amber-300 font-display whitespace-nowrap shrink-0"
          >
            CelestialPulse
          </a>

          {/* Zone 2: 4 clean single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'text-amber-300 underline underline-offset-8 decoration-amber-400'
                  : ''
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('energymap')}
              className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'energymap'
                  ? 'text-amber-300 underline underline-offset-8 decoration-amber-400'
                  : ''
              }`}
            >
              Energy Map
            </button>
            <button
              onClick={() => setActiveTab('sources')}
              className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'sources'
                  ? 'text-amber-300 underline underline-offset-8 decoration-amber-400'
                  : ''
              }`}
            >
              Sources
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'profile'
                  ? 'text-amber-300 underline underline-offset-8 decoration-amber-400'
                  : ''
              }`}
            >
              Natal Profile
            </button>
          </nav>

          {/* Zone 3: Primary action + PWA Install */}
          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />
            <button
              onClick={() => setActiveTab('profile')}
              className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Calibrate Chart
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container (Full 1440px-friendly max-w-7xl presence) */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Toast Feedback Banner */}
        {synthesisToast && (
          <div className="px-4 py-3 rounded-xl bg-violet-500/20 border border-violet-400/40 text-xs text-violet-100 flex items-center justify-between">
            <span>{synthesisToast}</span>
            <button
              onClick={() => setSynthesisToast(null)}
              className="text-violet-300 hover:text-white font-mono ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Cosmic Hero & Timezone / Sign Priority Workspace Bar */}
        <section className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left 8 Columns: Dominant Sign Forecast & Executive Synthesis */}
            <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
              <div>
                {/* Unboxed Inline Metadata (Zero-Pill Discipline) */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                  <span className="text-amber-300 font-semibold">
                    {primarySignMeta.glyph} {effectiveChart.sign} — {effectiveChart.mode}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Sun in {profile.sunSign}</span>
                  <span aria-hidden="true">·</span>
                  <span>Moon in {profile.moonSign}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-cyan-300">
                    {profile.operatingTimezone} ({formatTimezoneBadge(profile.operatingTimezone)})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500 italic">
                    Local demo — not generated forecast
                  </span>
                </div>

                <h1
                  className="text-2xl sm:text-3xl font-bold text-slate-100 mt-2 tracking-tight"
                  style={{ textWrap: 'balance' }}
                >
                  {currentForecast.dominantTransit}
                </h1>

                <p className="text-sm sm:text-base text-slate-300 mt-2.5 leading-relaxed max-w-3xl">
                  {currentForecast.executiveSummary}
                </p>
              </div>

              {/* Interactive Sign Rule & Operating Timezone Quick Controls */}
              <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400">Chart Priority Rule:</span>
                  <button
                    onClick={() =>
                      setProfile((prev) => ({
                        ...prev,
                        hasExactTime: true,
                        useRisingPrimary: true,
                        risingSign:
                          prev.risingSign ||
                          calculateRisingSign(
                            prev.birthDate,
                            prev.birthTime || '08:45',
                            prev.birthTimezone
                          ),
                      }))
                    }
                    className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      profile.hasExactTime && profile.useRisingPrimary
                        ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200'
                        : 'bg-[#080B14] border border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Rising Sign ({profile.risingSign || 'Scorpio'})
                  </button>
                  <button
                    onClick={() =>
                      setProfile((prev) => ({
                        ...prev,
                        useRisingPrimary: false,
                      }))
                    }
                    className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      !profile.hasExactTime || !profile.useRisingPrimary
                        ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200'
                        : 'bg-[#080B14] border border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Sun Sign Fallback ({profile.sunSign})
                  </button>
                </div>

                {/* Quick Operating Timezone Selector */}
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <label
                    htmlFor="quick-tz-select"
                    className="text-xs text-slate-400 whitespace-nowrap"
                  >
                    Local Timezone:
                  </label>
                  <select
                    id="quick-tz-select"
                    value={profile.operatingTimezone}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        operatingTimezone: e.target.value,
                      }))
                    }
                    className="h-9 px-2.5 rounded-lg bg-[#080B14] border border-slate-700 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.id} value={tz.id}>
                        {tz.city} ({formatTimezoneBadge(tz.id)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Right 4 Columns: Today's 6-Parameter Energy Snapshot */}
            <div className="lg:col-span-4 rounded-xl bg-[#080B14] border border-slate-800/90 p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                <div>
                  <div className="text-xs text-slate-400">
                    Daily Energy Index · {currentForecast.dayShort}
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-amber-300 mt-0.5">
                    {currentForecast.overallScore}
                    <span className="text-xs text-slate-500 font-normal"> / 100</span>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div className="text-slate-200 font-medium">
                    {currentForecast.lunarPhase}
                  </div>
                  <div className="font-mono tabular-nums">
                    {currentForecast.lunarIllumination}% Illumination
                  </div>
                </div>
              </div>

              <div className="my-3 space-y-2">
                {(
                  [
                    'mental',
                    'physical',
                    'creative',
                    'social',
                    'emotional',
                    'financialRisk',
                  ] as const
                ).map((dim) => {
                  const meta = ENERGY_DIMENSIONS_METADATA[dim];
                  // Average waking score for this dimension
                  const waking = currentForecast.hours.filter(
                    (h) => h.hourLocal >= 8 && h.hourLocal <= 20
                  );
                  const avg = Math.round(
                    waking.reduce((acc, h) => acc + h[dim], 0) / waking.length
                  );
                  return (
                    <div key={dim} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">{meta.label}</span>
                        <span className="font-mono tabular-nums text-slate-200">
                          {avg}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${avg}%`,
                            backgroundColor: meta.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  Active Sources: {sources.filter((s) => s.isActive).length}/{sources.length}
                </span>
                <button
                  onClick={() => setActiveTab('sources')}
                  className="text-amber-300 hover:underline cursor-pointer"
                >
                  Customize Feeds →
                </button>
              </div>
            </div>
          </div>

          {/* 7-Day Horizontal Date Scroller */}
          <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto">
            <div className="flex items-center gap-1.5">
              {weeklyForecasts.map((day, idx) => {
                const isSelected = idx === selectedDayIndex;
                return (
                  <button
                    key={day.dateIso}
                    onClick={() => setSelectedDayIndex(idx)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                        : 'bg-[#080B14] border border-slate-800/80 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span>{day.dayShort}</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        isSelected ? 'text-slate-900' : 'text-amber-300'
                      }`}
                    >
                      {day.overallScore}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 shrink-0">
              <Calendar className="w-3.5 h-3.5 text-violet-400" />
              <span>All transits normalized to UTC &amp; projected to {profile.operatingTimezone}</span>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Agent pipeline: Nebius query → Tavily search → Nebius aggregation
              → .ics calendar for{' '}
              <span className="text-amber-300 font-medium">
                {profile.targetMonth}
              </span>
            </p>
            <button
              onClick={() => triggerForecast()}
              disabled={forecastLoading}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {forecastLoading
                  ? 'Generating Forecast...'
                  : 'Generate Personal Forecast'}
              </span>
            </button>
          </div>
        </section>

        {/* Active Tab Viewport */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {forecastLoading && <AgentProgress currentStep={forecastStep || 1} />}

            {forecastError && !forecastLoading && (
              <div
                role="alert"
                className="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-400/40 text-xs text-rose-200 flex items-center justify-between"
              >
                <span>{forecastError}</span>
                <button
                  onClick={() => setForecastError(null)}
                  className="text-rose-300 hover:text-white font-mono ml-4 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {forecast && !forecastLoading && (
              <section className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
                  <div>
                    <div className="text-xs text-slate-400">
                      <span>Generated Monthly Forecast</span>
                      <span className="mx-2" aria-hidden="true">·</span>
                      <span className="font-mono text-amber-300">
                        {forecast.targetMonth}
                      </span>
                      <span className="mx-2" aria-hidden="true">·</span>
                      <span>
                        {new Date(forecast.generatedAt).toLocaleString()}
                      </span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
                      Monthly Theme
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      onClick={() =>
                        downloadIcs(
                          forecast.result.ics_content,
                          `celestialpulse-${forecast.targetMonth
                            .toLowerCase()
                            .replace(/\s+/g, '-')}.ics`
                        )
                      }
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .ics Calendar</span>
                    </button>
                    <CopyJsonButton rawJson={forecast.rawJson} />
                  </div>
                </div>

                <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-4xl">
                  {forecast.result.overall_theme}
                </p>

                {forecast.result.events.length === 0 ? (
                  <div className="px-4 py-6 rounded-xl bg-[#080B14] border border-slate-800/90 text-center">
                    <p className="text-sm text-slate-300 font-medium">
                      No source-backed events found for {forecast.targetMonth}.
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      The retrieved evidence did not contain adequately dated
                      items for this month — nothing was fabricated to fill the
                      gap.
                    </p>
                  </div>
                ) : (
                  <ol className="space-y-3">
                    {forecast.result.events.map((ev, idx) => (
                      <li
                        key={`${ev.date}-${idx}`}
                        className="p-4 rounded-xl bg-[#080B14] border border-slate-800/90"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="font-mono text-amber-300 font-medium">
                            {ev.date}
                            {ev.end_date ? ` → ${ev.end_date}` : ''}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${impactBadgeClasses(
                              ev.impact_type
                            )}`}
                          >
                            {ev.impact_type}
                          </span>
                          {ev.topics.map((t) => (
                            <span
                              key={t}
                              className="text-[11px] text-slate-400"
                            >
                              {PRIORITY_LABELS[t]}
                            </span>
                          ))}
                        </div>
                        <h3 className="text-base font-semibold text-slate-100 mt-1.5">
                          {ev.title}
                        </h3>
                        <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                          {ev.summary}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                          {ev.source_urls.map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-cyan-300 hover:underline font-mono truncate max-w-[300px]"
                            >
                              {url}
                            </a>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {/* Multi-Parameter Wave Chart */}
            <EnergyWaveChart
              forecasts={weeklyForecasts}
              selectedDayIndex={selectedDayIndex}
              onSelectDayIndex={setSelectedDayIndex}
              operatingTimezone={profile.operatingTimezone}
            />

            {/* Personalized Daily Activity Scheduler & Financial Caution Correlator */}
            <ActivityScheduler
              forecast={currentForecast}
              operatingTimezone={profile.operatingTimezone}
              customActivities={
                customActivitiesByDate[currentForecast.dateIso] || []
              }
              completedIds={completedIds}
              onToggleComplete={handleToggleComplete}
              onAddCustomActivity={handleAddCustomActivity}
              onSynthesizeWithGemini={() => triggerForecast()}
              isSynthesizing={forecastLoading}
            />

            <TransitHeatmapMatrix
              result={forecast?.result ?? null}
              targetMonth={forecast?.targetMonth ?? profile.targetMonth}
              priorities={forecast?.priorities ?? profile.priorities}
            />
          </div>
        )}

        {activeTab === 'energymap' && (
          <div className="space-y-6">
            <EnergyWaveChart
              forecasts={weeklyForecasts}
              selectedDayIndex={selectedDayIndex}
              onSelectDayIndex={setSelectedDayIndex}
              operatingTimezone={profile.operatingTimezone}
            />
            <TransitHeatmapMatrix
              result={forecast?.result ?? null}
              targetMonth={forecast?.targetMonth ?? profile.targetMonth}
              priorities={forecast?.priorities ?? profile.priorities}
            />
          </div>
        )}

        {activeTab === 'sources' && (
          <SourcesManager
            sources={sources}
            operatingTimezone={profile.operatingTimezone}
            onToggleSource={handleToggleSource}
            onChangeWeight={handleChangeSourceWeight}
            onAddSuggestedSource={handleAddSuggestedSource}
            onExtractLiveText={(excerpt) => {
              setActiveTab('dashboard');
              triggerForecast(excerpt);
            }}
            isSynthesizing={forecastLoading}
          />
        )}

        {activeTab === 'profile' && (
          <NatalProfilePanel
            profile={profile}
            onUpdateProfile={updateProfile}
            onSaveProfile={handleSaveProfile}
            isSavingProfile={isSavingProfile}
            saveProfileStatus={
              isSavingProfile
                ? saveProfileStatus
                : profileDirty
                ? 'Unsaved changes'
                : saveProfileStatus
            }
            backendUrlValid={isValidBackendUrl(profile.backendUrl)}
          />
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 mt-12 pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div>
          CelestialPulse · Multi-Source Astrological Synthesis &amp; UTC-Normalized Energy Maps
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('sources')}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Manage Crawled Sources
          </button>
          <span aria-hidden="true">·</span>
          <button
            onClick={() => setActiveTab('profile')}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Timezone &amp; Rising Sign Settings
          </button>
        </div>
      </footer>

      {/* Mobile Fixed Bottom Navigation Bar (Natural Thumb Zone, <15% viewport height) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080B14]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-4 items-center h-16 px-2"
      >
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'dashboard' ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">
            Dashboard
          </span>
        </button>

        <button
          onClick={() => setActiveTab('energymap')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'energymap' ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">
            Energy Map
          </span>
        </button>

        <button
          onClick={() => setActiveTab('sources')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'sources' ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          <Radio className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">
            Sources
          </span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'profile' ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          <UserCheck className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">
            Profile &amp; TZ
          </span>
        </button>
      </nav>

      {/* PWA Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
}

const CopyJsonButton: React.FC<{ rawJson: string }> = ({ rawJson }) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    try {
      await copyToClipboard(rawJson);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    setTimeout(() => setStatus('idle'), 2500);
  };

  return (
    <button
      onClick={handleCopy}
      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#080B14] hover:bg-slate-800/70 border border-slate-800 text-slate-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
    >
      <Clipboard className="w-3.5 h-3.5" />
      <span>
        {status === 'copied'
          ? 'Copied!'
          : status === 'failed'
          ? 'Copy Failed'
          : 'Copy Forecast JSON'}
      </span>
    </button>
  );
};
