import React, { useState } from 'react';
import {
  Check,
  ExternalLink,
  Globe,
  Newspaper,
  Plus,
  Radio,
  Sliders,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import {
  EnergyDimension,
  HoroscopeSource,
  SourceType,
} from '../types/astrology';
import { ENERGY_DIMENSIONS_METADATA } from '../utils/astrologyEngine';
import {
  TIMEZONE_OPTIONS,
  formatHourDecimal,
  formatTimezoneBadge,
  normalizeSourceHourToUtc,
  projectUtcHourToUserLocal,
} from '../utils/timezoneEngine';

interface SourcesManagerProps {
  sources: HoroscopeSource[];
  operatingTimezone: string;
  onToggleSource: (id: string) => void;
  onChangeWeight: (id: string, weight: number) => void;
  onAddSuggestedSource: (source: HoroscopeSource) => void;
  onExtractLiveText: (excerpt: string) => void;
  isSynthesizing: boolean;
}

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  newspaper: 'Newspaper Column',
  column: 'Astrology Syndicate',
  blog: 'Esoteric Blog',
  video: 'YouTube / Video Channel',
};

export const SourcesManager: React.FC<SourcesManagerProps> = ({
  sources,
  operatingTimezone,
  onToggleSource,
  onChangeWeight,
  onAddSuggestedSource,
  onExtractLiveText,
  isSynthesizing,
}) => {
  const [filterType, setFilterType] = useState<'all' | SourceType>('all');
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [livePasteText, setLivePasteText] = useState('');

  // Suggest Source form state
  const [newName, setNewName] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newType, setNewType] = useState<SourceType>('column');
  const [newUrl, setNewUrl] = useState('');
  const [newTimezone, setNewTimezone] = useState('America/New_York');
  const [newPublishHour, setNewPublishHour] = useState(8);
  const [newExtract, setNewExtract] = useState('');
  const [newFocusDims, setNewFocusDims] = useState<EnergyDimension[]>([
    'mental',
    'creative',
  ]);

  const filteredSources =
    filterType === 'all'
      ? sources
      : sources.filter((s) => s.type === filterType);

  const toggleFocusDim = (dim: EnergyDimension) => {
    setNewFocusDims((prev) =>
      prev.includes(dim)
        ? prev.length > 1
          ? prev.filter((d) => d !== dim)
          : prev
        : [...prev, dim]
    );
  };

  const handleSuggestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newAuthor.trim()) return;

    const created: HoroscopeSource = {
      id: `src-community-${Date.now()}`,
      name: newName.trim(),
      author: newAuthor.trim(),
      type: newType,
      url: newUrl.trim() || 'https://astrology.community/feed',
      sourceTimezone: newTimezone,
      publishedHourNative: newPublishHour,
      weight: 1.5,
      isActive: true,
      sampleExtract:
        newExtract.trim() ||
        'Planetary transits emphasize deliberate pacing during morning hours while opening favorable afternoon windows for strategic execution and creative collaboration.',
      focusDimensions: newFocusDims,
      lastCrawledUtc: new Date().toISOString(),
      isCommunitySuggested: true,
    };

    onAddSuggestedSource(created);
    setNewName('');
    setNewAuthor('');
    setNewUrl('');
    setNewExtract('');
    setShowSuggestModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Control Card */}
      <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <div className="text-xs text-slate-400">
              <span>Crawled Horoscope Feeds &amp; Timezone Standardization</span>
              <span className="mx-2" aria-hidden="true">·</span>
              <span>
                {sources.filter((s) => s.isActive).length} of {sources.length} Sources Active
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
              Customize Report Sources &amp; Extraction Weights
            </h2>
          </div>

          <button
            onClick={() => setShowSuggestModal(true)}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-2 transition-colors self-start cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Suggest New Source</span>
          </button>
        </div>

        {/* Source Type Filter Bar */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {(['all', 'column', 'newspaper', 'blog', 'video'] as const).map(
            (type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterType === type
                    ? 'bg-slate-800 text-amber-300 border border-slate-700'
                    : 'bg-[#080B14] text-slate-400 hover:text-slate-200 border border-slate-800/80'
                }`}
              >
                {type === 'all'
                  ? `All Sources (${sources.length})`
                  : SOURCE_TYPE_LABELS[type]}
              </button>
            )
          )}
        </div>

        {/* Source Cards List */}
        <div className="mt-5 divide-y divide-slate-800/80">
          {filteredSources.map((src) => {
            const { utcHour } = normalizeSourceHourToUtc(
              src.publishedHourNative,
              src.sourceTimezone
            );
            const { localHour, dayShiftFromUtcToLocal } =
              projectUtcHourToUserLocal(utcHour, operatingTimezone);

            return (
              <div
                key={src.id}
                className={`py-5 first:pt-2 last:pb-1 transition-opacity ${
                  src.isActive ? '' : 'opacity-55'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1">
                    {/* Unboxed inline metadata */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span className="text-amber-300 font-medium">
                        {SOURCE_TYPE_LABELS[src.type]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>By {src.author}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-cyan-300">
                        Source TZ: {src.sourceTimezone} ({formatTimezoneBadge(src.sourceTimezone)})
                      </span>
                      {src.isCommunitySuggested && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-300 font-medium">
                            Community Verified
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5">
                      <h3 className="text-base font-semibold text-slate-100">
                        {src.name}
                      </h3>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-500 hover:text-slate-300 transition-colors"
                        title={`Source URL: ${src.url}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    <p className="text-sm text-slate-300 leading-relaxed">
                      &ldquo;{src.sampleExtract}&rdquo;
                    </p>

                    {/* Timezone Conversion Chain */}
                    <div className="pt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-slate-400">
                      <Globe className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span>
                        Native Dispatch: {formatHourDecimal(src.publishedHourNative)} ({src.sourceTimezone.split('/').pop()})
                      </span>
                      <span className="text-slate-600" aria-hidden="true">→</span>
                      <span className="text-violet-300">
                        Normalized: {formatHourDecimal(utcHour)} UTC
                      </span>
                      <span className="text-slate-600" aria-hidden="true">→</span>
                      <span className="text-amber-200">
                        Your Local: {formatHourDecimal(localHour)} ({operatingTimezone.split('/').pop()})
                        {dayShiftFromUtcToLocal !== 0
                          ? ` [${dayShiftFromUtcToLocal > 0 ? '+1d' : '-1d'}]`
                          : ''}
                      </span>
                    </div>

                    {/* Focus Dimensions */}
                    <div className="pt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                      <span>Extracted Parameters:</span>
                      {src.focusDimensions.map((dim, idx) => (
                        <React.Fragment key={dim}>
                          <span style={{ color: ENERGY_DIMENSIONS_METADATA[dim].color }}>
                            {ENERGY_DIMENSIONS_METADATA[dim].shortLabel}
                          </span>
                          {idx < src.focusDimensions.length - 1 && (
                            <span aria-hidden="true">·</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  {/* Right Controls: Active Toggle & Weight Multiplier */}
                  <div className="flex sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800/60">
                    <button
                      onClick={() => onToggleSource(src.id)}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-colors cursor-pointer ${
                        src.isActive
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{src.isActive ? 'Included in Report' : 'Excluded'}</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-slate-500 mr-1" />
                      <span className="text-xs text-slate-400 mr-1">Weight:</span>
                      {[0.5, 1.0, 1.5, 2.0].map((w) => (
                        <button
                          key={w}
                          onClick={() => onChangeWeight(src.id, w)}
                          disabled={!src.isActive}
                          className={`min-h-[32px] px-2 py-1 rounded-md font-mono text-xs transition-colors cursor-pointer disabled:opacity-40 ${
                            Math.abs(src.weight - w) < 0.1
                              ? 'bg-amber-500 text-slate-950 font-semibold'
                              : 'bg-[#080B14] border border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {w.toFixed(1)}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Horoscope Column / Transcript Extractor */}
      <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800/80">
          <div>
            <div className="text-xs text-slate-400">
              On-Demand Column, Blog &amp; Video Transcript Parser
            </div>
            <h3 className="text-base font-semibold text-slate-100 mt-0.5">
              Correlate Custom Horoscope Excerpt into Your Energy Map
            </h3>
          </div>
          <span className="text-xs font-mono text-violet-300">
            Auto-Normalizes to UTC → {operatingTimezone}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <textarea
            rows={3}
            value={livePasteText}
            onChange={(e) => setLivePasteText(e.target.value)}
            placeholder="Paste any horoscope paragraph, newspaper column snippet, or YouTube astrologer transcript with transit times (e.g., 'Mercury trine Jupiter at 11:00 AM EST opens a breakthrough career window, but avoid financial speculation after 4:00 PM EST')..."
            className="w-full p-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
          />
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-400">
              Extracts transit windows, normalizes source timestamps to UTC, and updates your personalized schedule.
            </p>
            <button
              onClick={() => {
                if (livePasteText.trim()) {
                  onExtractLiveText(livePasteText.trim());
                  setLivePasteText('');
                }
              }}
              disabled={!livePasteText.trim() || isSynthesizing}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-400 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isSynthesizing ? 'Extracting...' : 'Extract & Correlate Now'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Suggest a New Source Modal */}
      {showSuggestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[#10172A] border border-slate-800 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-100">
                  Suggest Additional Horoscope Source
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Community-suggested sources are normalized to UTC and made available to all users.
                </p>
              </div>
              <button
                onClick={() => setShowSuggestModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSuggestSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Publication / Channel Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Café Astrology Daily"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Astrologer / Author
                  </label>
                  <input
                    type="text"
                    required
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    placeholder="e.g., Annie Heese"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Source Format
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as SourceType)}
                    className="w-full h-11 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    <option value="column">Astrology Column</option>
                    <option value="newspaper">Newspaper Horoscope</option>
                    <option value="blog">Astrology Blog</option>
                    <option value="video">YouTube Video Channel</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Source Native Timezone
                  </label>
                  <select
                    value={newTimezone}
                    onChange={(e) => setNewTimezone(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.id} value={tz.id}>
                        {tz.city} ({tz.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Source URL / Feed Link
                  </label>
                  <input
                    type="url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Typical Publish Hour (Source TZ)
                  </label>
                  <select
                    value={newPublishHour}
                    onChange={(e) => setNewPublishHour(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-400"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, '0')}:00 ({newTimezone.split('/').pop()})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Primary Energy Dimensions Covered
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(ENERGY_DIMENSIONS_METADATA) as EnergyDimension[]).map(
                    (dim) => {
                      const active = newFocusDims.includes(dim);
                      return (
                        <button
                          type="button"
                          key={dim}
                          onClick={() => toggleFocusDim(dim)}
                          className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                            active
                              ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200'
                              : 'bg-[#080B14] border border-slate-800 text-slate-400'
                          }`}
                        >
                          {ENERGY_DIMENSIONS_METADATA[dim].shortLabel}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Sample Horoscope / Transit Dispatch Excerpt
                </label>
                <textarea
                  rows={3}
                  value={newExtract}
                  onChange={(e) => setNewExtract(e.target.value)}
                  placeholder="Paste a recent forecast excerpt to initialize source extraction..."
                  className="w-full p-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSuggestModal(false)}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Add &amp; Verify Source
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
