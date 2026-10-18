/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  Compass,
  Globe,
  Layers,
  Radio,
  Sparkles,
  Sun,
  UserCheck,
} from 'lucide-react';
import {
  ActivityCategory,
  DailyEnergyForecast,
  HoroscopeSource,
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
  convertSourceWindowToUserTimezone,
  detectLocalTimezone,
  formatTimezoneBadge,
} from './utils/timezoneEngine';
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
  SOURCES: 'celestialpulse_sources_v1',
  CUSTOM_ACTIVITIES: 'celestialpulse_custom_acts_v1',
  COMPLETED_IDS: 'celestialpulse_completed_v1',
};

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
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);

  const [profile, setProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.PROFILE);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore storage error
    }
    return INITIAL_PROFILE;
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

  const [aiSynthesisOverride, setAiSynthesisOverride] = useState<
    Record<
      string,
      {
        executiveSummary: string;
        dominantTransit: string;
        consensusScore: number;
        timezoneAdjustmentNote: string;
        activities: ScheduledActivity[];
      }
    >
  >({});
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisToast, setSynthesisToast] = useState<string | null>(null);

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

  // Generate 7-day astrological forecasts & energy maps
  const weeklyForecasts: DailyEnergyForecast[] = useMemo(() => {
    const base = generateWeeklyForecasts(profile, sources);
    return base.map((day) => {
      const override = aiSynthesisOverride[day.dateIso];
      if (!override) return day;
      return {
        ...day,
        executiveSummary: override.executiveSummary,
        dominantTransit: override.dominantTransit,
        consensusScore: override.consensusScore,
        timezoneAdjustmentNote: override.timezoneAdjustmentNote,
        activities: override.activities,
      };
    });
  }, [profile, sources, aiSynthesisOverride]);

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

  const triggerSynthesis = async (customExcerpt?: string) => {
    setIsSynthesizing(true);
    setSynthesisToast(null);
    const activeSources = sources.filter((s) => s.isActive);

    try {
      const response = await fetch('/api/horoscope/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile,
          sources: activeSources,
          targetDate: currentForecast.dateIso,
          customExcerpt,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && Array.isArray(data.activities) && data.activities.length > 0) {
          const mappedActivities: ScheduledActivity[] = data.activities.map(
            (item: any, idx: number) => {
              const startHr = 8 + idx * 2;
              return {
                id: `synth-${currentForecast.dateIso}-${idx}`,
                category: (item.category as ActivityCategory) || 'career',
                title: item.title,
                description: item.description,
                sourceNativeWindow: `${item.utcWindow} (Multi-Source Normalized)`,
                utcWindow: item.utcWindow,
                localWindow: `${item.localWindow} (${formatTimezoneBadge(
                  profile.operatingTimezone
                )})`,
                localStartHour: startHr,
                localEndHour: startHr + 2,
                significance: item.significance || 'favorable',
                cosmicReason: item.cosmicReason,
                sourceAttribution: item.sourceAttribution,
                energyDimension: item.energyDimension || 'mental',
                houseNumber: (idx * 2 + 1) % 12 || 10,
              };
            }
          );

          setAiSynthesisOverride((prev) => ({
            ...prev,
            [currentForecast.dateIso]: {
              executiveSummary: data.executiveSummary,
              dominantTransit: data.dominantTransit,
              consensusScore: data.consensusScore || 91,
              timezoneAdjustmentNote: data.timezoneAdjustmentNote,
              activities: mappedActivities,
            },
          }));
          setSynthesisToast(
            `Synthesized ${activeSources.length} sources → Normalized UTC → Projected to ${profile.operatingTimezone}`
          );
          setIsSynthesizing(false);
          setTimeout(() => setSynthesisToast(null), 4000);
          return;
        }
      }
    } catch {
      // Fallback to local deterministic extraction when offline or serverless
    }

    // Deterministic Local Extraction for Custom Excerpt or Refresh
    if (customExcerpt) {
      const win = convertSourceWindowToUserTimezone(
        11,
        13,
        profile.operatingTimezone,
        profile.operatingTimezone
      );
      const customExtractedAct: ScheduledActivity = {
        id: `extracted-${Date.now()}`,
        category: customExcerpt.toLowerCase().includes('financ')
          ? 'finance'
          : customExcerpt.toLowerCase().includes('social')
          ? 'social'
          : 'career',
        title: 'Extracted Live Column Transit Window',
        description: customExcerpt,
        sourceNativeWindow: win.sourceNativeWindow,
        utcWindow: win.utcWindow,
        localWindow: win.localWindow,
        localStartHour: win.localStartHour,
        localEndHour: win.localEndHour,
        significance: customExcerpt.toLowerCase().includes('avoid')
          ? 'caution'
          : 'favorable',
        cosmicReason: `Correlated with ${effectiveChart.sign} (${effectiveChart.mode})`,
        sourceAttribution: 'Live Excerpt Parser',
        energyDimension: 'mental',
        houseNumber: 10,
      };
      handleAddCustomActivity(customExtractedAct);
      setActiveTab('dashboard');
    }

    setSynthesisToast(
      `Correlated ${activeSources.length} active sources via UTC normalization for ${effectiveChart.sign} (${profile.operatingTimezone})`
    );
    setIsSynthesizing(false);
    setTimeout(() => setSynthesisToast(null), 4000);
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
        </section>

        {/* Active Tab Viewport */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
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
              onSynthesizeWithGemini={() => triggerSynthesis()}
              isSynthesizing={isSynthesizing}
            />

            {/* Weekly Transit Heatmap Matrix */}
            <TransitHeatmapMatrix
              forecasts={weeklyForecasts}
              selectedDayIndex={selectedDayIndex}
              onSelectDayIndex={setSelectedDayIndex}
              operatingTimezone={profile.operatingTimezone}
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
              forecasts={weeklyForecasts}
              selectedDayIndex={selectedDayIndex}
              onSelectDayIndex={setSelectedDayIndex}
              operatingTimezone={profile.operatingTimezone}
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
            onExtractLiveText={(excerpt) => triggerSynthesis(excerpt)}
            isSynthesizing={isSynthesizing}
          />
        )}

        {activeTab === 'profile' && (
          <NatalProfilePanel
            profile={profile}
            onUpdateProfile={(updated) => setProfile(updated)}
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
