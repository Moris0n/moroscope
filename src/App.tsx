/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { SourceSettings, UserProfile } from './types/astrology';
import { getEffectiveChartSign } from './utils/astrologyEngine';
import { detectLocalTimezone } from './utils/timezoneEngine';
import {
  DEFAULT_BACKEND_URL,
  DEFAULT_SOURCE_SETTINGS,
  defaultTargetMonth,
  isLegacyProfile,
  isValidBackendUrl,
  mergeProfileWithDefaults,
  primarySign,
  profileProblem,
  reviveSourceSettings,
  toGeneralProfile,
} from './utils/forecastShared';
import {
  STORAGE_KEYS,
  readStoredString,
  usePersistentState,
  writeStoredString,
} from './utils/storage';
import { INVALID_BACKEND_URL_MESSAGE, saveProfile } from './api/forecastApi';
import { useForecast } from './hooks/useForecast';
import { useNatalChart } from './hooks/useNatalChart';
import { ActiveTab, AppHeader, MobileNav } from './components/Navigation';
import { AgentProgress } from './components/AgentProgress';
import { ForecastResults } from './components/ForecastResults';
import { ProfileSummary } from './components/ProfileSummary';
import { TransitHeatmapMatrix } from './components/TransitHeatmapMatrix';
import { SourcesManager } from './components/SourcesManager';
import { NatalProfilePanel } from './components/NatalProfilePanel';
import { OfflineIndicator } from './components/OfflineIndicator';
import { Onboarding, OnboardingStep } from './components/Onboarding';

// Nothing is known about a new user: onboarding fills this in.
const INITIAL_PROFILE: UserProfile = {
  mode: 'general',
  lifeContext: undefined,
  name: '',
  birthDate: '',
  birthTime: '',
  hasExactTime: false,
  birthLocation: '',
  birthTimezone: detectLocalTimezone(),
  operatingTimezone: detectLocalTimezone(),
  sunSign: 'Aries',
  moonSign: 'Aries',
  useRisingPrimary: false,
  targetMonth: defaultTargetMonth(),
  focusAreas: [],
  backendUrl: DEFAULT_BACKEND_URL,
};

const reviveProfile = (saved: unknown) =>
  mergeProfileWithDefaults(INITIAL_PROFILE, saved);

// Onboarding is done once it was completed here, or if a profile from before it existed is stored.
function wasOnboarded(): boolean {
  if (readStoredString(STORAGE_KEYS.ONBOARDED) === '1') return true;
  try {
    return isLegacyProfile(JSON.parse(readStoredString(STORAGE_KEYS.PROFILE) ?? 'null'));
  } catch {
    return false;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [profile, setProfile] = usePersistentState<UserProfile>(
    STORAGE_KEYS.PROFILE,
    INITIAL_PROFILE,
    reviveProfile
  );
  const [sourceSettings, setSourceSettings] = usePersistentState<SourceSettings>(
    STORAGE_KEYS.SOURCE_SETTINGS,
    DEFAULT_SOURCE_SETTINGS,
    reviveSourceSettings
  );
  // Which onboarding screen is open, if any. 'birth' is the "Personalise my forecast" entry.
  const [onboarding, setOnboarding] = useState<OnboardingStep | null>(() =>
    wasOnboarded() ? null : 'choice'
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
    clearForecasts,
  } = useForecast(profile.targetMonth);

  const chartStatus = useNatalChart(profile, setProfile);

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

  const finishOnboarding = (next: UserProfile) => {
    setProfile(next);
    writeStoredString(STORAGE_KEYS.ONBOARDED, '1');
    setOnboarding(null);
    setActiveTab('dashboard');
  };

  const handleRemovePersonalDetails = () => {
    if (
      !window.confirm(
        'Remove your name, birth details, life answers and saved forecasts from this device? Your forecast becomes a general one for your sign.'
      )
    )
      return;
    setProfile((prev) => toGeneralProfile(prev, getEffectiveChartSign(prev).sign));
    // Stored forecasts hold personal notes written from the life answers.
    clearForecasts();
    setSaveProfileStatus(null);
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

  const triggerForecast = async (
    options: { customExcerpt?: string; includeCurated?: boolean } = {}
  ) => {
    if (forecastLoading) return;
    setActiveTab('dashboard');
    if (!isValidBackendUrl(profile.backendUrl)) {
      setForecastError(INVALID_BACKEND_URL_MESSAGE);
      return;
    }
    const problem = profileProblem(profile);
    if (problem) {
      setForecastError(problem);
      return;
    }
    setToast(null);
    const payload = await generate({
      profile,
      profileId,
      sources: sourceSettings,
      ...options,
    });
    if (!payload) return;
    rememberProfileId(payload.profileId);
    showToast(
      `Generated ${payload.result.events.length} source-backed events for ${profile.targetMonth}`,
      5000
    );
  };

  if (onboarding) {
    return (
      <Onboarding
        profile={profile}
        initialStep={onboarding}
        onComplete={finishOnboarding}
        onCancel={onboarding === 'choice' ? undefined : () => setOnboarding(null)}
      />
    );
  }

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

            {forecast && !forecastLoading && (
              <ForecastResults
                forecast={forecast}
                madeFor={
                  forecast.sign !== primarySign(profile).sign || forecast.mode !== profile.mode
                    ? `${forecast.sign}, ${forecast.mode === 'personal' ? 'personal' : 'general'}`
                    : null
                }
                onRetryWithDefaultSources={() => triggerForecast({ includeCurated: true })}
              />
            )}

            <TransitHeatmapMatrix
              result={forecast?.result ?? null}
              targetMonth={forecast?.targetMonth ?? profile.targetMonth}
              areas={forecast?.focusAreas ?? profile.focusAreas}
            />
          </div>
        )}

        {activeTab === 'sources' && (
          <SourcesManager
            settings={sourceSettings}
            onChange={setSourceSettings}
            backendUrl={isValidBackendUrl(profile.backendUrl) ? profile.backendUrl : ''}
            report={forecast?.sources ?? null}
            reportMonth={forecast?.targetMonth ?? null}
            onExtractLiveText={(customExcerpt) => triggerForecast({ customExcerpt })}
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
            chartStatus={chartStatus}
            onPersonalise={() => setOnboarding('birth')}
            onRemovePersonalDetails={handleRemovePersonalDetails}
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
            Profile Settings
          </button>
        </div>
      </footer>

      <MobileNav activeTab={activeTab} onSelectTab={setActiveTab} />
      <OfflineIndicator />
    </div>
  );
}
