import React from 'react';
import { Compass, Globe, Sparkles, Sun, Moon, Clock } from 'lucide-react';
import {
  ActivityCategory,
  UserProfile,
  ZodiacSign,
} from '../types/astrology';
import {
  CATEGORY_METADATA,
  ZODIAC_METADATA,
  ZODIAC_SIGNS,
  calculateMoonSign,
  calculateRisingSign,
  calculateSunSign,
  getEffectiveChartSign,
} from '../utils/astrologyEngine';
import {
  TIMEZONE_OPTIONS,
  detectLocalTimezone,
  formatTimezoneBadge,
} from '../utils/timezoneEngine';

interface NatalProfilePanelProps {
  profile: UserProfile;
  onUpdateProfile: (updated: UserProfile) => void;
}

const ALL_CATEGORIES: ActivityCategory[] = [
  'career',
  'finance',
  'social',
  'hobbies',
  'wellness',
  'strategic',
  'mind',
  'rest',
];

export const NatalProfilePanel: React.FC<NatalProfilePanelProps> = ({
  profile,
  onUpdateProfile,
}) => {
  const effectiveChart = getEffectiveChartSign(profile);
  const sunMeta = ZODIAC_METADATA[profile.sunSign];
  const moonMeta = ZODIAC_METADATA[profile.moonSign];
  const risingMeta = profile.risingSign
    ? ZODIAC_METADATA[profile.risingSign]
    : undefined;

  const handleBirthChange = (
    field: 'birthDate' | 'birthTime' | 'birthTimezone' | 'hasExactTime',
    value: string | boolean
  ) => {
    const next = { ...profile, [field]: value };
    next.sunSign = calculateSunSign(next.birthDate);
    next.moonSign = calculateMoonSign(
      next.birthDate,
      next.hasExactTime ? next.birthTime : '12:00',
      next.birthTimezone
    );
    if (next.hasExactTime && next.birthTime) {
      next.risingSign = calculateRisingSign(
        next.birthDate,
        next.birthTime,
        next.birthTimezone
      );
      next.useRisingPrimary = true;
    } else {
      next.useRisingPrimary = false;
    }
    onUpdateProfile(next);
  };

  const toggleCategory = (cat: ActivityCategory) => {
    const exists = profile.activeCategories.includes(cat);
    if (exists && profile.activeCategories.length <= 1) return;
    const nextCats = exists
      ? profile.activeCategories.filter((c) => c !== cat)
      : [...profile.activeCategories, cat];
    onUpdateProfile({ ...profile, activeCategories: nextCats });
  };

  const handleAutoDetectTimezone = () => {
    const detected = detectLocalTimezone();
    onUpdateProfile({ ...profile, operatingTimezone: detected });
  };

  return (
    <div className="space-y-6">
      {/* Natal Chart Triad Summary */}
      <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <div className="text-xs text-slate-400">
              <span>Astrological Identity &amp; House Cusps Engine</span>
              <span className="mx-2" aria-hidden="true">·</span>
              <span className="text-amber-300 font-medium">
                Active Chart Ruler: {effectiveChart.sign} ({effectiveChart.mode})
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
              {profile.name}&apos;s Natal Triad &amp; Timezone Calibration
            </h2>
          </div>

          {/* Priority Mode Toggle: Rising Sign vs Sun Sign */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#080B14] border border-slate-800 self-start">
            <button
              type="button"
              onClick={() => {
                if (!profile.hasExactTime) {
                  handleBirthChange('hasExactTime', true);
                } else {
                  onUpdateProfile({ ...profile, useRisingPrimary: true });
                }
              }}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                profile.hasExactTime && profile.useRisingPrimary
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Rising Sign Priority (Ascendant)
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateProfile({ ...profile, useRisingPrimary: false })
              }
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                !profile.hasExactTime || !profile.useRisingPrimary
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sun Sign Fallback
            </button>
          </div>
        </div>

        {/* 3-Column NatalPlacements */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Rising Sign / Ascendant (Primary if available) */}
          <div
            className={`p-4 rounded-xl border ${
              profile.hasExactTime && profile.useRisingPrimary
                ? 'bg-[#080B14] border-amber-400/50'
                : 'bg-[#080B14]/60 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-amber-300">
                <Compass className="w-3.5 h-3.5" />
                Rising Sign (Ascendant)
              </span>
              <span>
                {profile.hasExactTime && profile.useRisingPrimary
                  ? 'Primary Ruler'
                  : 'Time Unknown / Inactive'}
              </span>
            </div>

            {profile.hasExactTime && risingMeta ? (
              <>
                <div className="mt-2 flex items-baseline gap-2.5">
                  <span className="text-3xl font-display text-amber-300">
                    {risingMeta.glyph}
                  </span>
                  <span className="text-xl font-bold text-slate-100">
                    {risingMeta.sign}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {risingMeta.element} · {risingMeta.modality} · Ruled by {risingMeta.ruler}
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  {risingMeta.keywords}
                </p>
                <div className="mt-3 pt-3 border-t border-slate-800/80">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Manual Ascendant Override:
                  </label>
                  <select
                    value={profile.risingSign || profile.sunSign}
                    onChange={(e) =>
                      onUpdateProfile({
                        ...profile,
                        risingSign: e.target.value as ZodiacSign,
                        hasExactTime: true,
                        useRisingPrimary: true,
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg bg-[#10172A] border border-slate-700 text-xs text-slate-200"
                  >
                    {ZODIAC_SIGNS.map((s) => (
                      <option key={s} value={s}>
                        {ZODIAC_METADATA[s].glyph} {s} Rising
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Exact birth time is currently turned off. Recommendations automatically use your <strong>{profile.sunSign} Sun Sign</strong> solar houses.
                </p>
                <button
                  type="button"
                  onClick={() => handleBirthChange('hasExactTime', true)}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Enter Birth Time to Enable Rising Sign
                </button>
              </div>
            )}
          </div>

          {/* Sun Sign */}
          <div
            className={`p-4 rounded-xl border ${
              !profile.hasExactTime || !profile.useRisingPrimary
                ? 'bg-[#080B14] border-amber-400/50'
                : 'bg-[#080B14]/60 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-amber-200">
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                Sun Sign (Core Vitality)
              </span>
              <span>
                {!profile.hasExactTime || !profile.useRisingPrimary
                  ? 'Active Fallback Ruler'
                  : 'Solar Identity'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="text-3xl font-display text-amber-400">
                {sunMeta.glyph}
              </span>
              <span className="text-xl font-bold text-slate-100">
                {sunMeta.sign}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {sunMeta.element} · {sunMeta.modality} · Ruled by {sunMeta.ruler}
            </p>
            <p className="mt-2 text-xs text-slate-300">{sunMeta.keywords}</p>
            <div className="mt-3 pt-3 border-t border-slate-800/80">
              <label className="block text-[11px] text-slate-400 mb-1">
                Manual Sun Sign Override:
              </label>
              <select
                value={profile.sunSign}
                onChange={(e) =>
                  onUpdateProfile({
                    ...profile,
                    sunSign: e.target.value as ZodiacSign,
                  })
                }
                className="w-full h-9 px-2.5 rounded-lg bg-[#10172A] border border-slate-700 text-xs text-slate-200"
              >
                {ZODIAC_SIGNS.map((s) => (
                  <option key={s} value={s}>
                    {ZODIAC_METADATA[s].glyph} {s} ({ZODIAC_METADATA[s].dateRange})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Moon Sign */}
          <div className="p-4 rounded-xl bg-[#080B14]/60 border border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 font-medium text-violet-300">
                <Moon className="w-3.5 h-3.5 text-violet-400" />
                Moon Sign (Emotional Current)
              </span>
              <span>Lunar Biorhythm</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="text-3xl font-display text-violet-300">
                {moonMeta.glyph}
              </span>
              <span className="text-xl font-bold text-slate-100">
                {moonMeta.sign}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {moonMeta.element} · {moonMeta.modality} · Ruled by {moonMeta.ruler}
            </p>
            <p className="mt-2 text-xs text-slate-300">{moonMeta.keywords}</p>
            <div className="mt-3 pt-3 border-t border-slate-800/80">
              <label className="block text-[11px] text-slate-400 mb-1">
                Manual Moon Sign Override:
              </label>
              <select
                value={profile.moonSign}
                onChange={(e) =>
                  onUpdateProfile({
                    ...profile,
                    moonSign: e.target.value as ZodiacSign,
                  })
                }
                className="w-full h-9 px-2.5 rounded-lg bg-[#10172A] border border-slate-700 text-xs text-slate-200"
              >
                {ZODIAC_SIGNS.map((s) => (
                  <option key={s} value={s}>
                    {ZODIAC_METADATA[s].glyph} {s} Moon
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Birth Details & Dual Timezone Configuration */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Profile Name
            </label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) =>
                onUpdateProfile({ ...profile, name: e.target.value })
              }
              className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Birth Date (Calculates Sun &amp; Moon)
            </label>
            <input
              type="date"
              value={profile.birthDate}
              onChange={(e) => handleBirthChange('birthDate', e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">
                Birth Time (For Rising Sign)
              </label>
              <button
                type="button"
                onClick={() =>
                  handleBirthChange('hasExactTime', !profile.hasExactTime)
                }
                className="text-[11px] text-amber-300 hover:underline cursor-pointer"
              >
                {profile.hasExactTime ? 'Time Unknown?' : 'Have Exact Time?'}
              </button>
            </div>
            {profile.hasExactTime ? (
              <input
                type="time"
                value={profile.birthTime}
                onChange={(e) => handleBirthChange('birthTime', e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-400"
              />
            ) : (
              <div className="h-11 px-3.5 rounded-xl bg-[#080B14]/60 border border-slate-800/80 flex items-center text-xs text-slate-400">
                Using Sun Sign Solar Houses
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Birth Location Timezone
            </label>
            <select
              value={profile.birthTimezone}
              onChange={(e) =>
                handleBirthChange('birthTimezone', e.target.value)
              }
              className="w-full h-11 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-400"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.city} ({tz.id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Operating Timezone Calibration Section */}
        <div className="mt-6 p-4 rounded-xl bg-[#080B14] border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-cyan-300">
              <Globe className="w-4 h-4 shrink-0" />
              <span>Active Event Calendar &amp; Energy Map Timezone</span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono text-amber-300">
                {formatTimezoneBadge(profile.operatingTimezone)}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              All crawled horoscope sources are first normalized from their native timezones to <strong>UTC</strong>, then adjusted to your operating timezone below.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              value={profile.operatingTimezone}
              onChange={(e) =>
                onUpdateProfile({
                  ...profile,
                  operatingTimezone: e.target.value,
                })
              }
              className="h-10 px-3 rounded-xl bg-[#10172A] border border-slate-700 text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-400"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label} — {formatTimezoneBadge(tz.id)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleAutoDetectTimezone}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Detect Local TZ</span>
            </button>
          </div>
        </div>

        {/* Activity Category Personalization */}
        <div className="mt-6 pt-5 border-t border-slate-800/80">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Prioritized Daily Activity Categories
              </h3>
              <p className="text-xs text-slate-400">
                Select which life domains should be correlated into your daily schedule and caution alerts.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onUpdateProfile({
                  ...profile,
                  activeCategories: ALL_CATEGORIES,
                })
              }
              className="text-xs text-amber-300 hover:underline cursor-pointer"
            >
              Enable All 8 Domains
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {ALL_CATEGORIES.map((cat) => {
              const meta = CATEGORY_METADATA[cat];
              const isSelected = profile.activeCategories.includes(cat);
              return (
                <button
                  type="button"
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#080B14] border-amber-400/50 text-slate-100'
                      : 'bg-[#080B14]/40 border-slate-800/70 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className={isSelected ? meta.colorClass : 'text-slate-400'}>
                      {meta.shortLabel}
                    </span>
                    <span className="font-mono text-[10px]">
                      {isSelected ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {meta.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
