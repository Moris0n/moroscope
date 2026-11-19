import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, UserCheck } from 'lucide-react';
import { LifeArea, UserProfile, ZodiacSign } from '../types/astrology';
import { useNatalChart } from '../hooks/useNatalChart';
import {
  LIFE_AREAS,
  LIFE_AREA_LABELS,
  isValidBirthTime,
  parseIsoDate,
  toGeneralProfile,
} from '../utils/forecastShared';
import { MAX_BIRTH_YEAR, MIN_BIRTH_YEAR, chartBasis } from '../utils/chart';
import { BirthPlaceSearch } from './BirthPlaceSearch';
import { LifeContextForm } from './LifeContextForm';
import { SignPicker } from './SignPicker';

export type OnboardingStep = 'choice' | 'sign' | 'birth' | 'life' | 'focus';

interface OnboardingProps {
  profile: UserProfile;
  initialStep?: OnboardingStep;
  onComplete: (profile: UserProfile) => void;
  onCancel?: () => void; // present when the user opened this from the Profile tab
}

const PERSONAL_STEPS: OnboardingStep[] = ['birth', 'life', 'focus'];

const primaryButton =
  'min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const secondaryButton =
  'min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer';
const inputClasses =
  'w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400';

/**
 * First-run questions. Works on a draft: nothing reaches the stored profile until the last step,
 * so leaving half-way changes nothing.
 */
export const Onboarding: React.FC<OnboardingProps> = ({
  profile,
  initialStep = 'choice',
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [draft, setDraft] = useState<UserProfile>(() =>
    initialStep === 'birth' ? { ...profile, mode: 'personal' } : profile
  );
  const [sign, setSign] = useState<ZodiacSign | null>(
    profile.mode === 'general' && onCancel ? profile.sunSign : null
  );
  const chartStatus = useNatalChart(draft, setDraft);

  const birthDate = parseIsoDate(draft.birthDate);
  const birthDateValid =
    !!birthDate && birthDate.year >= MIN_BIRTH_YEAR && birthDate.year <= MAX_BIRTH_YEAR;
  const birthTimeValid = !draft.hasExactTime || isValidBirthTime(draft.birthTime);
  const chartReady = draft.chart?.basis === chartBasis(draft);
  const hasPlace = draft.birthPlace?.tz === draft.birthTimezone;

  const back = () => {
    if (step === 'sign' || step === 'birth') {
      if (initialStep === 'choice') setStep('choice');
      else onCancel?.();
    } else if (step === 'life') setStep('birth');
    else if (step === 'focus') setStep('life');
  };

  const toggleFocusArea = (area: LifeArea) =>
    setDraft((prev) => ({
      ...prev,
      focusAreas: prev.focusAreas.includes(area)
        ? prev.focusAreas.filter((a) => a !== area)
        : [...prev.focusAreas, area],
    }));

  const personalIndex = PERSONAL_STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-[#080B14] text-slate-100 flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-bold tracking-tight text-amber-300 font-display">
            Moroscope
          </span>
          {personalIndex >= 0 && (
            <span className="text-xs text-slate-400">
              Step {personalIndex + 1} of {PERSONAL_STEPS.length}
            </span>
          )}
        </div>

        {step === 'choice' && (
          <div className="mt-6">
            <h1 className="text-2xl font-bold text-slate-100">
              What kind of forecast would you like?
            </h1>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Moroscope reads this month&apos;s forecasts from astrologers you trust and turns them
              into dated advice you can add to your calendar.
            </p>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setDraft((prev) => ({ ...prev, mode: 'personal' }));
                  setStep('birth');
                }}
                className="p-4 rounded-xl bg-[#080B14] border border-slate-800 hover:border-amber-400/60 text-left transition-colors cursor-pointer"
              >
                <UserCheck className="w-5 h-5 text-amber-300" />
                <span className="block text-base font-semibold text-slate-100 mt-2">
                  Personalised forecast
                </span>
                <span className="block text-xs text-slate-400 mt-1 leading-relaxed">
                  A few questions about your birth and your life right now, so the advice fits
                  your situation. Every question is optional except your birth date.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStep('sign')}
                className="p-4 rounded-xl bg-[#080B14] border border-slate-800 hover:border-amber-400/60 text-left transition-colors cursor-pointer"
              >
                <Sparkles className="w-5 h-5 text-violet-300" />
                <span className="block text-base font-semibold text-slate-100 mt-2">
                  General forecast
                </span>
                <span className="block text-xs text-slate-400 mt-1 leading-relaxed">
                  Just pick your sign. No name, no birth details, no questions.
                </span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-5 leading-relaxed">
              With a personalised forecast, your answers about your life are sent to the AI service
              that writes the forecast. Your name, birth date, birth time and birth place are not
              sent to it: they go only to the Moroscope server, which calculates your signs.
              Nothing about you is ever put into a web search. You can remove your details at any
              time on the Profile tab.
            </p>
          </div>
        )}

        {step === 'sign' && (
          <div className="mt-6">
            <h1 className="text-2xl font-bold text-slate-100">Pick your sign</h1>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Choose your Rising sign if you know it. Otherwise choose your Sun sign, the one that
              goes with your birthday.
            </p>
            <div className="mt-5">
              <SignPicker value={sign} onChange={setSign} />
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button type="button" onClick={back} className={secondaryButton}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                disabled={!sign}
                onClick={() => sign && onComplete(toGeneralProfile(draft, sign))}
                className={primaryButton}
              >
                Go to my plan
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 'birth' && (
          <div className="mt-6">
            <h1 className="text-2xl font-bold text-slate-100">Your birth details</h1>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              These are used to calculate your Sun, Moon and Rising signs.
            </p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ob-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Name or nickname (optional)
                </label>
                <input
                  id="ob-name"
                  type="text"
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="ob-date" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Birth date
                </label>
                <input
                  id="ob-date"
                  type="date"
                  value={draft.birthDate}
                  onChange={(e) => setDraft((prev) => ({ ...prev, birthDate: e.target.value }))}
                  className={`${inputClasses} font-mono`}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="ob-time" className="text-xs font-medium text-slate-300">
                    Birth time
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!draft.hasExactTime}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          hasExactTime: !e.target.checked,
                          useRisingPrimary: e.target.checked ? false : prev.useRisingPrimary,
                        }))
                      }
                      className="w-3.5 h-3.5 accent-amber-400"
                    />
                    I don&apos;t know it
                  </label>
                </div>
                <input
                  id="ob-time"
                  type="time"
                  disabled={!draft.hasExactTime}
                  value={draft.hasExactTime ? draft.birthTime : ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, birthTime: e.target.value }))}
                  className={`${inputClasses} font-mono disabled:opacity-40`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Birth place
                </label>
                <BirthPlaceSearch
                  value={draft.birthLocation}
                  backendUrl={draft.backendUrl}
                  onSelect={(place) =>
                    setDraft((prev) => ({
                      ...prev,
                      birthPlace: place,
                      birthLocation: place.label,
                      birthTimezone: place.tz,
                    }))
                  }
                />
              </div>
            </div>

            <div className="mt-4 min-h-[40px] text-xs" role="status">
              {!birthDateValid ? (
                <span className="text-slate-500">
                  Enter your birth date to see your signs. The time and place are needed only for
                  the Rising sign.
                </span>
              ) : chartStatus.state === 'error' ? (
                <span className="text-rose-300">
                  {chartStatus.error}{' '}
                  <button type="button" onClick={chartStatus.retry} className="underline cursor-pointer">
                    Retry
                  </button>
                </span>
              ) : !chartReady ? (
                <span className="text-slate-400">Calculating your signs…</span>
              ) : (
                <span className="text-slate-300">
                  Sun in <strong className="text-amber-200">{draft.sunSign}</strong>, Moon in{' '}
                  <strong className="text-violet-200">{draft.moonSign}</strong>
                  {draft.risingSign ? (
                    <>
                      , <strong className="text-amber-200">{draft.risingSign}</strong> rising.
                    </>
                  ) : (
                    <>
                      .{' '}
                      <span className="text-slate-500">
                        {draft.hasExactTime && hasPlace
                          ? ''
                          : 'Add your birth time and pick a city from the list to get your Rising sign; until then your Sun sign is used.'}
                      </span>
                    </>
                  )}
                </span>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button type="button" onClick={back} className={secondaryButton}>
                <ArrowLeft className="w-4 h-4" />
                {initialStep === 'choice' ? 'Back' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={!birthDateValid || !birthTimeValid || !chartReady}
                onClick={() => setStep('life')}
                className={primaryButton}
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 'life' && (
          <div className="mt-6">
            <h1 className="text-2xl font-bold text-slate-100">Your life right now</h1>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Answer what you like and skip the rest. These answers are sent to the AI service that
              writes your forecast so the advice fits your situation.
            </p>
            <div className="mt-5">
              <LifeContextForm
                value={draft.lifeContext}
                onChange={(lifeContext) => setDraft((prev) => ({ ...prev, lifeContext }))}
              />
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button type="button" onClick={back} className={secondaryButton}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, lifeContext: undefined }));
                    setStep('focus');
                  }}
                  className={secondaryButton}
                >
                  Skip
                </button>
                <button type="button" onClick={() => setStep('focus')} className={primaryButton}>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'focus' && (
          <div className="mt-6">
            <h1 className="text-2xl font-bold text-slate-100">What matters most this month?</h1>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Pick the life areas your forecast should concentrate on, most important first.
              Pick none to cover all of them.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {LIFE_AREAS.map((priority) => {
                const selected = draft.focusAreas.includes(priority);
                return (
                  <button
                    type="button"
                    key={priority}
                    aria-pressed={selected}
                    onClick={() => toggleFocusArea(priority)}
                    className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                        : 'bg-[#080B14] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {LIFE_AREA_LABELS[priority]}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button type="button" onClick={back} className={secondaryButton}>
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button type="button" onClick={() => onComplete(draft)} className={primaryButton}>
                Go to my plan
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
