/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { HoroscopeSource, UserProfile } from './types/astrology';
import {
  DEFAULT_SOURCES,
  calculateMoonSign,
  calculateRisingSign,
  calculateSunSign,
} from './utils/astrologyEngine';
import { detectLocalTimezone } from './utils/timezoneEngine';
import {
  DEFAULT_BACKEND_URL,
  defaultTargetMonth,
  isValidBackendUrl,
  mergeProfileWithDefaults,
} from './utils/forecastShared';
import {
  STORAGE_KEYS,
  readStoredString,
  usePersistentState,
  writeStoredString,
} from './utils/storage';
import { INVALID_BACKEND_URL_MESSAGE, saveProfile } from './api/forecastApi';
import { useForecast } from './hooks/useForecast';
import { ActiveTab, AppHeader, MobileNav } from './components/Navigation';
import { AgentProgress } from './components/AgentProgress';
import { ForecastResults } from './components/ForecastResults';
import { ProfileSummary } from './components/ProfileSummary';
import { TransitHeatmapMatrix } from './components/TransitHeatmapMatrix';
import { SourcesManager } from './components/SourcesManager';
import { NatalProfilePanel } from './components/NatalProfilePanel';
import { OfflineIndicator } from './components/OfflineIndicator';

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
  targetMonth: defaultTargetMonth(),
  priorities: ['careerTransition', 'financialPlanning'],
  backendUrl: DEFAULT_BACKEND_URL,
};

const reviveProfile = (saved: unknown) =>
  mergeProfileWithDefaults(INITIAL_PROFILE, saved);

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [profile, setProfile] = usePersistentState<UserProfile>(
    STORAGE_KEYS.PROFILE,
    INITIAL_PROFILE,
    reviveProfile
  );
  const [sources, setSources] = usePersistentState<HoroscopeSource[]>(
    STORAGE_KEYS.SOURCES,
    DEFAULT_SOURCES
  );
  const [profileId, setProfileId] = useState<string | null>(() =>
    readStoredString(STORAGE_KEYS.PROFILE_ID)
  );

  const {
    forecast,
    loading: forecastLoading,
    step: forecastStep,
    error: forecastError,
    setError: setForecastError,
    generate,
  } = useForecast();

  const [saveProfileStatus, setSaveProfileStatus] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const savedProfileRef = useRef<UserProfile | null>(null);
  const profileDirty = savedProfileRef.current !== profile;
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (message: string, ms: number) => {
    setToast(message);
    setTimeout(() => setToast(null), ms);
  };

  const rememberProfileId = (id: string | null) => {
    if (!id || id === profileId) return;
    setProfileId(id);
    writeStoredString(STORAGE_KEYS.PROFILE_ID, id);
  };

  const handleToggleSource = (id: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s))
    );
  };

  const handleChangeSourceWeight = (id: string, weight: number) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, weight } : s)));
  };

  const handleAddSuggestedSource = (newSource: HoroscopeSource) => {
    setSources((prev) => [newSource, ...prev]);
    showToast(`Added "${newSource.name}"`, 4000);
  };

  const handleSaveProfile = async () => {
    if (isSavingProfile) return;
    if (!isValidBackendUrl(profile.backendUrl)) {
      setSaveProfileStatus(INVALID_BACKEND_URL_MESSAGE);
      return;
    }
    setIsSavingProfile(true);
    setSaveProfileStatus(null);
    const snapshot = profile;
    try {
      const id = await saveProfile(snapshot, profileId);
      rememberProfileId(id);
      savedProfileRef.current = snapshot;
      setSaveProfileStatus(`Profile saved (ID ${id || 'n/a'}).`);
    } catch (err: any) {
      setSaveProfileStatus(err?.message || 'Save failed.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const triggerForecast = async (customExcerpt?: string) => {
    if (forecastLoading) return;
    setActiveTab('dashboard');
    if (!isValidBackendUrl(profile.backendUrl)) {
      setForecastError(INVALID_BACKEND_URL_MESSAGE);
      return;
    }
    setToast(null);
    const payload = await generate(profile, profileId, customExcerpt);
    if (!payload) return;
    rememberProfileId(payload.profileId);
    showToast(
      `Generated ${payload.result.events.length} source-backed events for ${profile.targetMonth}`,
      5000
    );
  };

  return (
    <div className="min-h-screen bg-[#080B14] text-slate-100 pb-24 md:pb-12">
      <AppHeader activeTab={activeTab} onSelectTab={setActiveTab} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {toast && (
          <div className="px-4 py-3 rounded-xl bg-violet-500/20 border border-violet-400/40 text-xs text-violet-100 flex items-center justify-between">
            <span>{toast}</span>
            <button
              onClick={() => setToast(null)}
              className="text-violet-300 hover:text-white font-mono ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <ProfileSummary
          profile={profile}
          onUpdateProfile={setProfile}
          onGenerateForecast={() => triggerForecast()}
          forecastLoading={forecastLoading}
        />

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

            {forecast && !forecastLoading && <ForecastResults forecast={forecast} />}

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
            onExtractLiveText={(excerpt) => triggerForecast(excerpt)}
            isSynthesizing={forecastLoading}
          />
        )}

        {activeTab === 'profile' && (
          <NatalProfilePanel
            profile={profile}
            onUpdateProfile={setProfile}
            onSaveProfile={handleSaveProfile}
            isSavingProfile={isSavingProfile}
            saveProfileStatus={
              !isSavingProfile && profileDirty ? 'Unsaved changes' : saveProfileStatus
            }
            backendUrlValid={isValidBackendUrl(profile.backendUrl)}
          />
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 mt-12 pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <div>Moroscope · Personal monthly astrology planner</div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('sources')}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Manage Sources
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

      <MobileNav activeTab={activeTab} onSelectTab={setActiveTab} />
      <OfflineIndicator />
    </div>
  );
}
