import React from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { UserProfile } from '../types/astrology';
import { ZODIAC_METADATA, getEffectiveChartSign } from '../utils/astrologyEngine';
import { TIMEZONE_OPTIONS, formatTimezoneBadge } from '../utils/timezoneEngine';

interface ProfileSummaryProps {
  profile: UserProfile;
  onUpdateProfile: (update: (prev: UserProfile) => UserProfile) => void;
  onGenerateForecast: () => void;
  forecastLoading: boolean;
}

const toggleClasses = (active: boolean) =>
  `min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
    active
      ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200'
      : 'bg-[#080B14] border border-slate-800 text-slate-400 hover:text-slate-200'
  }`;

export const ProfileSummary: React.FC<ProfileSummaryProps> = ({
  profile,
  onUpdateProfile,
  onGenerateForecast,
  forecastLoading,
}) => {
  const effectiveChart = getEffectiveChartSign(profile);
  const risingActive = profile.hasExactTime && profile.useRisingPrimary;
  const personal = profile.mode === 'personal';
  const name = personal ? profile.name.trim() : '';

  return (
    <section className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span className="text-amber-300 font-semibold">
          {ZODIAC_METADATA[effectiveChart.sign].glyph} {effectiveChart.sign} —{' '}
          {personal ? effectiveChart.mode : 'General forecast'}
        </span>
        {personal && (
          <>
            <span aria-hidden="true">·</span>
            <span>Sun in {profile.sunSign}</span>
            <span aria-hidden="true">·</span>
            <span>Moon in {profile.moonSign}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="font-mono text-cyan-300">
          {profile.operatingTimezone} ({formatTimezoneBadge(profile.operatingTimezone)})
        </span>
      </div>

      <h1
        className="text-2xl sm:text-3xl font-bold text-slate-100 mt-2 tracking-tight"
        style={{ textWrap: 'balance' }}
      >
        {name ? `${name}'s plan` : 'Your plan'} for {profile.targetMonth}
      </h1>

      <p className="text-sm sm:text-base text-slate-300 mt-2.5 leading-relaxed max-w-3xl">
        Generate a forecast to get the month&apos;s key dates, good-time windows
        and cautions, each backed by a published astrology source and ready to
        export to your calendar.
      </p>

      <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className={`flex flex-wrap items-center gap-2 ${personal ? '' : 'hidden'}`}>
          <span className="text-xs text-slate-400">Chart Priority Rule:</span>
          <button
            onClick={() =>
              onUpdateProfile((prev) => ({
                ...prev,
                hasExactTime: true,
                useRisingPrimary: true,
              }))
            }
            className={toggleClasses(risingActive)}
          >
            Rising Sign ({profile.risingSign || 'not set'})
          </button>
          <button
            onClick={() =>
              onUpdateProfile((prev) => ({ ...prev, useRisingPrimary: false }))
            }
            className={toggleClasses(!risingActive)}
          >
            Sun Sign Fallback ({profile.sunSign})
          </button>
        </div>

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
              onUpdateProfile((prev) => ({
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

      <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          Reads your trusted sources, writes the forecast and builds an .ics
          calendar for{' '}
          <span className="text-amber-300 font-medium">{profile.targetMonth}</span>
        </p>
        <button
          onClick={onGenerateForecast}
          disabled={forecastLoading}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          <span>
            {forecastLoading
              ? 'Generating Forecast...'
              : personal
              ? 'Generate Personal Forecast'
              : 'Generate Forecast'}
          </span>
        </button>
      </div>
    </section>
  );
};
