import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, Globe, Plus, Sparkles, Trash2, Video } from 'lucide-react';
import {
  CuratedSource,
  SourceReport,
  SourceSettings,
  SourceStatus,
} from '../types/astrology';
import { fetchCuratedSources } from '../api/sourcesApi';
import {
  MAX_USER_SOURCES,
  normalizeSourceUrl,
  sourceUrlKey,
} from '../utils/forecastShared';

interface SourcesManagerProps {
  settings: SourceSettings;
  onChange: (update: (prev: SourceSettings) => SourceSettings) => void;
  backendUrl: string;
  report: SourceReport[] | null; // from the last forecast
  reportMonth: string | null;
  onExtractLiveText: (excerpt: string) => void;
  isSynthesizing: boolean;
}

const STATUS_TEXT: Record<SourceStatus, { label: string; classes: string }> = {
  used: { label: 'Used', classes: 'text-emerald-300' },
  no_forecast: { label: 'No forecast yet', classes: 'text-amber-300' },
  failed: { label: 'Could not be read', classes: 'text-rose-300' },
};

const isYouTube = (url: string) => /(^|\.)(youtube\.com|youtu\.be)$/.test(new URL(url).hostname);

function describeUserSource(url: string): string {
  const u = new URL(url);
  if (isYouTube(url)) return 'YouTube: the monthly video of this channel is read';
  if (u.pathname === '/' && !u.search) return 'Whole site: searched for the month';
  return 'Page: read directly';
}

const SourceToggle: React.FC<{ active: boolean; onClick: () => void; name: string }> = ({
  active,
  onClick,
  name,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    aria-label={`${active ? 'Turn off' : 'Turn on'} ${name}`}
    className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-colors whitespace-nowrap cursor-pointer ${
      active
        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
    }`}
  >
    <Check className="w-3.5 h-3.5" />
    <span>{active ? 'On' : 'Off'}</span>
  </button>
);

const StatusLine: React.FC<{ entry: SourceReport | undefined; month: string | null }> = ({
  entry,
  month,
}) =>
  entry ? (
    <p className={`text-xs mt-1 ${STATUS_TEXT[entry.status].classes}`}>
      {STATUS_TEXT[entry.status].label}
      {month ? ` for ${month}` : ''}
      {entry.status !== 'used' && entry.reason ? `: ${entry.reason}` : ''}
    </p>
  ) : null;

export const SourcesManager: React.FC<SourcesManagerProps> = ({
  settings,
  onChange,
  backendUrl,
  report,
  reportMonth,
  onExtractLiveText,
  isSynthesizing,
}) => {
  const [curated, setCurated] = useState<CuratedSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [livePasteText, setLivePasteText] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    fetchCuratedSources(backendUrl, controller.signal)
      .then(setCurated)
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoadError(
          err instanceof TypeError
            ? 'Cannot reach the server to load the default sources.'
            : err?.message || 'The default sources could not be loaded.'
        );
      });
    return () => controller.abort();
  }, [backendUrl]);

  const activeUser = settings.user.filter((s) => s.active);
  const exclusive = activeUser.length > 0;
  const statusOf = (id: string) => report?.find((entry) => entry.id === id);

  const toggleCurated = (id: string) =>
    onChange((prev) => ({
      ...prev,
      disabledCurated: prev.disabledCurated.includes(id)
        ? prev.disabledCurated.filter((x) => x !== id)
        : [...prev.disabledCurated, id],
    }));

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeSourceUrl(newUrl);
    if (!url) {
      setAddError('Enter a web address such as https://example.com/monthly-horoscope.');
      return;
    }
    if (settings.user.some((s) => sourceUrlKey(s.url) === sourceUrlKey(url))) {
      setAddError('That source is already in your list.');
      return;
    }
    if (settings.user.length >= MAX_USER_SOURCES) {
      setAddError(`You can add up to ${MAX_USER_SOURCES} sources.`);
      return;
    }
    const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    onChange((prev) => ({ ...prev, user: [...prev.user, { id, url, active: true }] }));
    setNewUrl('');
    setAddError(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
        <div className="pb-5 border-b border-slate-800/80">
          <div className="text-xs text-slate-400">
            Where your forecast comes from · English sources
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">Your sources</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Add astrologers you trust: a page with a monthly horoscope, a whole site, or a YouTube
            channel that publishes a monthly video. If you add any, only yours are used.
          </p>
        </div>

        {exclusive && (
          <p
            role="status"
            className="mt-4 px-4 py-3 rounded-xl bg-violet-500/15 border border-violet-400/40 text-xs text-violet-100"
          >
            Only your sources are used. The default sources below are ignored while one of yours is
            switched on.
          </p>
        )}

        <form onSubmit={handleAdd} className="mt-4 flex flex-col sm:flex-row gap-2">
          <label htmlFor="new-source-url" className="sr-only">
            Address of a source
          </label>
          <input
            id="new-source-url"
            type="text"
            inputMode="url"
            value={newUrl}
            onChange={(e) => {
              setNewUrl(e.target.value);
              setAddError(null);
            }}
            placeholder="https://example.com/monthly-horoscope or a YouTube channel"
            className="flex-1 h-11 px-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add source
          </button>
        </form>
        {addError && (
          <p role="alert" className="mt-1.5 text-xs text-rose-300">
            {addError}
          </p>
        )}

        {settings.user.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-800/80">
            {settings.user.map((source) => (
              <li
                key={source.id}
                className={`py-3 flex items-start justify-between gap-3 ${
                  source.active ? '' : 'opacity-55'
                }`}
              >
                <div className="min-w-0">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-slate-100 hover:underline break-all"
                  >
                    {source.url}
                  </a>
                  <p className="text-xs text-slate-400 mt-0.5">{describeUserSource(source.url)}</p>
                  {source.active && <StatusLine entry={statusOf(source.id)} month={reportMonth} />}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <SourceToggle
                    active={source.active}
                    name={source.url}
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        user: prev.user.map((s) =>
                          s.id === source.id ? { ...s, active: !s.active } : s
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        user: prev.user.filter((s) => s.id !== source.id),
                      }))
                    }
                    aria-label={`Remove ${source.url}`}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800/60 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={`rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6 ${
          exclusive ? 'opacity-60' : ''
        }`}
      >
        <div className="pb-4 border-b border-slate-800/80">
          <h3 className="text-base font-semibold text-slate-100">Default sources</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Read directly each time you generate a forecast. If fewer than two have something for
            the month, the open web is searched as well.
          </p>
        </div>

        {loadError ? (
          <p role="alert" className="mt-4 text-xs text-rose-300">
            {loadError}
          </p>
        ) : curated === null ? (
          <p className="mt-4 text-xs text-slate-400">Loading…</p>
        ) : (
          <ul className="divide-y divide-slate-800/80">
            {curated.map((source) => {
              const active = !settings.disabledCurated.includes(source.id);
              const Icon = source.type === 'video' ? Video : Globe;
              return (
                <li
                  key={source.id}
                  className={`py-4 flex items-start justify-between gap-3 ${
                    active ? '' : 'opacity-55'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-amber-300 shrink-0" aria-hidden="true" />
                      <span className="text-sm font-semibold text-slate-100">{source.name}</span>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${source.name}`}
                        className="text-slate-500 hover:text-slate-300"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      By {source.author} · {source.cadence}
                    </p>
                    {active && !exclusive && (
                      <StatusLine entry={statusOf(source.id)} month={reportMonth} />
                    )}
                  </div>
                  <SourceToggle
                    active={active}
                    name={source.name}
                    onClick={() => toggleCurated(source.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
        <div className="pb-4 border-b border-slate-800/80">
          <h3 className="text-base font-semibold text-slate-100">
            Add a pasted excerpt to your next forecast
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            The text is passed to the forecast writer as extra context. It cannot be cited, so it
            never creates an event on its own.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <label htmlFor="excerpt-text" className="sr-only">
            Excerpt
          </label>
          <textarea
            id="excerpt-text"
            rows={3}
            maxLength={8000}
            value={livePasteText}
            onChange={(e) => setLivePasteText(e.target.value)}
            placeholder="Paste a paragraph from a horoscope, a newsletter or a video transcript"
            className="w-full p-3.5 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
          />
          <div className="flex justify-end">
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
              <span>{isSynthesizing ? 'Generating...' : 'Generate forecast with this excerpt'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
