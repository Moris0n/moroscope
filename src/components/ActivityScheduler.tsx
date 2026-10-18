import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Globe,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import {
  ActivityCategory,
  DailyEnergyForecast,
  ScheduledActivity,
} from '../types/astrology';
import { CATEGORY_METADATA } from '../utils/astrologyEngine';
import { convertSourceWindowToUserTimezone } from '../utils/timezoneEngine';

interface ActivitySchedulerProps {
  forecast: DailyEnergyForecast;
  operatingTimezone: string;
  customActivities: ScheduledActivity[];
  completedIds: string[];
  onToggleComplete: (id: string) => void;
  onAddCustomActivity: (activity: ScheduledActivity) => void;
  onSynthesizeWithGemini: () => void;
  isSynthesizing: boolean;
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

export const ActivityScheduler: React.FC<ActivitySchedulerProps> = ({
  forecast,
  operatingTimezone,
  customActivities,
  completedIds,
  onToggleComplete,
  onAddCustomActivity,
  onSynthesizeWithGemini,
  isSynthesizing,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | ActivityCategory>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<ActivityCategory>('career');
  const [newDescription, setNewDescription] = useState('');
  const [newStartHour, setNewStartHour] = useState<number>(10);
  const [newDurationHours, setNewDurationHours] = useState<number>(2);

  const combinedActivities = [...customActivities, ...forecast.activities].sort(
    (a, b) => a.localStartHour - b.localStartHour
  );

  const visibleActivities =
    selectedCategory === 'all'
      ? combinedActivities
      : combinedActivities.filter((a) => a.category === selectedCategory);

  // Recommend optimal local hour based on forecast hours for the chosen category
  const getRecommendedHourForCategory = (cat: ActivityCategory): number => {
    const waking = forecast.hours.filter((h) => h.hourLocal >= 7 && h.hourLocal <= 22);
    if (waking.length === 0) return 10;
    const sorted = [...waking].sort((a, b) => {
      if (cat === 'career' || cat === 'strategic') return b.mental - a.mental;
      if (cat === 'social') return b.social - a.social;
      if (cat === 'hobbies') return b.creative - a.creative;
      if (cat === 'wellness') return b.physical - a.physical;
      if (cat === 'finance') return a.financialRisk - b.financialRisk; // Lowest risk hour for finance!
      return b.emotional - a.emotional;
    });
    return sorted[0].hourLocal;
  };

  const handleOpenAddModal = () => {
    const recHour = getRecommendedHourForCategory('career');
    setNewStartHour(recHour);
    setShowAddModal(true);
  };

  const handleCategoryChangeInModal = (cat: ActivityCategory) => {
    setNewCategory(cat);
    setNewStartHour(getRecommendedHourForCategory(cat));
  };

  const handleCreateActivity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const endHour = (newStartHour + newDurationHours) % 24;
    const converted = convertSourceWindowToUserTimezone(
      newStartHour,
      endHour,
      operatingTimezone,
      operatingTimezone
    );

    const slot = forecast.hours[newStartHour] || forecast.hours[10];
    const isHighFinanceRisk =
      newCategory === 'finance' && slot.financialRisk >= 65;

    const created: ScheduledActivity = {
      id: `custom-${Date.now()}`,
      category: newCategory,
      title: newTitle.trim(),
      description:
        newDescription.trim() ||
        `User-scheduled ${CATEGORY_METADATA[newCategory].label.toLowerCase()} aligned with ${forecast.chartRulerUsed.sign} (${forecast.chartRulerUsed.mode}).`,
      sourceNativeWindow: converted.sourceNativeWindow,
      utcWindow: converted.utcWindow,
      localWindow: converted.localWindow,
      localStartHour: newStartHour,
      localEndHour: endHour,
      significance: isHighFinanceRisk
        ? 'caution'
        : newCategory === 'finance'
        ? 'neutral'
        : 'favorable',
      cosmicReason: `${slot.dominantAspect} · ${slot.activePlanet} Planetary Hour`,
      sourceAttribution: 'Personal Activity Categorizer',
      energyDimension:
        newCategory === 'career' || newCategory === 'strategic'
          ? 'mental'
          : newCategory === 'social'
          ? 'social'
          : newCategory === 'hobbies'
          ? 'creative'
          : newCategory === 'wellness'
          ? 'physical'
          : newCategory === 'finance'
          ? 'financialRisk'
          : 'emotional',
      houseNumber: newCategory === 'career' ? 10 : newCategory === 'finance' ? 2 : 5,
      isUserCustom: true,
    };

    onAddCustomActivity(created);
    setNewTitle('');
    setNewDescription('');
    setShowAddModal(false);
  };

  return (
    <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
        <div>
          <div className="text-xs text-slate-400">
            <span>Timezone-Normalized Daily Activity Correlator</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Prioritized by {forecast.chartRulerUsed.sign} {forecast.chartRulerUsed.mode}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
            Actionable Schedule &amp; Caution Windows — {forecast.dayLabel}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onSynthesizeWithGemini}
            disabled={isSynthesizing}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/30 text-violet-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-300 shrink-0" />
            <span>{isSynthesizing ? 'Synthesizing Feeds...' : 'Refresh Multi-Source Synthesis'}</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Categorize Activity</span>
          </button>
        </div>
      </div>

      {/* Timezone Normalization Banner */}
      <div className="mt-4 px-4 py-3 rounded-xl bg-[#080B14] border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{forecast.timezoneAdjustmentNote}</span>
        </div>
        <div className="font-mono text-amber-300 shrink-0">
          Consensus: {forecast.consensusScore}%
        </div>
      </div>

      {/* Category Filter Buttons */}
      <div className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-slate-800 text-amber-300'
              : 'bg-[#080B14] text-slate-400 hover:text-slate-200'
          }`}
        >
          All Categories ({combinedActivities.length})
        </button>

        {ALL_CATEGORIES.map((cat) => {
          const meta = CATEGORY_METADATA[cat];
          const count = combinedActivities.filter((a) => a.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-slate-800 text-amber-300 border border-slate-700'
                  : 'bg-[#080B14] text-slate-400 hover:text-slate-200'
              }`}
            >
              {meta.shortLabel} ({count})
            </button>
          );
        })}
      </div>

      {/* Activity Rows */}
      <div className="mt-4 divide-y divide-slate-800/80">
        {visibleActivities.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-slate-400">
              No scheduled activities in this category for {forecast.dayLabel}.
            </p>
            <button
              onClick={handleOpenAddModal}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Schedule Custom Activity
            </button>
          </div>
        ) : (
          visibleActivities.map((act) => {
            const catMeta = CATEGORY_METADATA[act.category] || CATEGORY_METADATA.career;
            const isCaution = act.significance === 'caution' || act.category === 'finance';
            const isDone = completedIds.includes(act.id);

            return (
              <div
                key={act.id}
                className={`py-4 first:pt-2 last:pb-1 transition-opacity ${
                  isDone ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <button
                    onClick={() => onToggleComplete(act.id)}
                    className="min-h-[44px] min-w-[44px] -ml-2 -mt-1 flex items-center justify-center text-slate-400 hover:text-amber-300 transition-colors shrink-0 cursor-pointer"
                    aria-label={isDone ? 'Mark as incomplete' : 'Mark as completed'}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : isCaution ? (
                      <AlertTriangle className="w-5 h-5 text-rose-400" />
                    ) : (
                      <Circle className="w-5 h-5" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Unboxed inline metadata row (Zero-Pill Discipline) */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className={`font-semibold ${catMeta.colorClass}`}>
                        {catMeta.label}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-amber-200 font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                        {act.localWindow}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        Normalized: {act.utcWindow}
                      </span>
                      {act.dayShiftNote && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-cyan-300 font-mono">
                            {act.dayShiftNote}
                          </span>
                        </>
                      )}
                    </div>

                    <h3
                      className={`text-base font-semibold text-slate-100 mt-1 ${
                        isDone ? 'line-through text-slate-400' : ''
                      }`}
                    >
                      {act.title}
                    </h3>

                    <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                      {act.description}
                    </p>

                    {/* Cosmic & Source Attribution Footnote */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span>Transit Driver: <strong className="text-slate-300 font-normal">{act.cosmicReason}</strong></span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span>Source: {act.sourceAttribution}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        Source Raw: {act.sourceNativeWindow}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Categorize & Schedule Custom Activity Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#10172A] border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-100">
                  Categorize &amp; Align Custom Activity
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Correlates your task with optimal local transit hours for {forecast.chartRulerUsed.sign}
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateActivity} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Activity Category
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {ALL_CATEGORIES.map((cat) => {
                    const meta = CATEGORY_METADATA[cat];
                    const active = newCategory === cat;
                    return (
                      <button
                        type="button"
                        key={cat}
                        onClick={() => handleCategoryChangeInModal(cat)}
                        className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors truncate cursor-pointer ${
                          active
                            ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200'
                            : 'bg-[#080B14] border border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {meta.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Activity Title
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Launch new client proposal, Evening oil painting, Contract review"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Start Hour ({operatingTimezone.split('/').pop()})
                  </label>
                  <select
                    value={newStartHour}
                    onChange={(e) => setNewStartHour(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  >
                    {forecast.hours.map((h) => (
                      <option key={h.hourLocal} value={h.hourLocal}>
                        {h.timeLabelLocal} ({h.timeLabelUtc}) — Vitality {h.compositeVitality}%
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Duration
                  </label>
                  <select
                    value={newDurationHours}
                    onChange={(e) => setNewDurationHours(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  >
                    <option value={1}>1 Hour</option>
                    <option value={2}>2 Hours</option>
                    <option value={3}>3 Hours</option>
                    <option value={4}>4 Hours</option>
                  </select>
                </div>
              </div>

              {/* Recommended Cosmic Alignment Preview */}
              <div className="p-3 rounded-xl bg-[#080B14] border border-slate-800/90 text-xs text-slate-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Optimal Recommended Start:</span>
                  <button
                    type="button"
                    onClick={() => setNewStartHour(getRecommendedHourForCategory(newCategory))}
                    className="font-mono text-amber-300 hover:underline cursor-pointer"
                  >
                    Apply {String(getRecommendedHourForCategory(newCategory)).padStart(2, '0')}:00 Local Peak
                  </button>
                </div>
                <div className="text-slate-400">
                  Selected Hour Transit:{' '}
                  <span className="text-slate-200">
                    {forecast.hours[newStartHour]?.dominantAspect}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Notes &amp; Context (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Specific objectives or parameters to track..."
                  className="w-full p-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Add to Personal Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
