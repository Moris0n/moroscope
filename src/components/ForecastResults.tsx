import React, { useState } from 'react';
import { Clipboard, Download } from 'lucide-react';
import { StoredForecast } from '../hooks/useForecast';
import { PRIORITY_LABELS } from '../utils/forecastShared';
import {
  copyToClipboard,
  downloadIcs,
  impactBadgeClasses,
  sourceLabel,
} from '../utils/forecastHelpers';

const STATUS_LABELS = {
  used: { label: 'used', classes: 'text-emerald-300' },
  no_forecast: { label: 'no forecast yet', classes: 'text-amber-300' },
  failed: { label: 'could not be read', classes: 'text-rose-300' },
} as const;

const EVIDENCE_NOTES = {
  user: 'Built only from the sources you added.',
  curated: 'Built from the default sources.',
  web: 'The default sources had too little for this month, so the open web was searched as well.',
} as const;

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

interface ForecastResultsProps {
  forecast: StoredForecast;
  onRetryWithDefaultSources: () => void;
}

export const ForecastResults: React.FC<ForecastResultsProps> = ({
  forecast,
  onRetryWithDefaultSources,
}) => {
  const { sources, evidence } = forecast;
  return (
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
                `moroscope-${forecast.targetMonth
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
            The sources did not contain adequately dated items for this
            month — nothing was made up to fill the gap.
          </p>
          {evidence?.gap && evidence.mode === 'user' && (
            <button
              type="button"
              onClick={onRetryWithDefaultSources}
              className="mt-4 min-h-[42px] px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
            >
              Also use default sources
            </button>
          )}
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
                    title={url}
                    className="text-[11px] text-cyan-300 hover:underline truncate max-w-[300px]"
                  >
                    {sourceLabel(url, sources)}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {sources.length > 0 && (
        <div className="pt-4 border-t border-slate-800/80">
          <h3 className="text-xs font-semibold text-slate-300">Sources for this forecast</h3>
          {evidence && <p className="text-xs text-slate-500 mt-0.5">{EVIDENCE_NOTES[evidence.mode]}</p>}
          <ul className="mt-2 space-y-1">
            {sources.map((source) => (
              <li key={source.id} className="text-xs text-slate-400">
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-200 hover:underline"
                  >
                    {source.name}
                  </a>
                ) : (
                  <span className="text-slate-200">{source.name}</span>
                )}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                <span className={STATUS_LABELS[source.status].classes}>
                  {STATUS_LABELS[source.status].label}
                </span>
                {source.status !== 'used' && source.reason ? ` (${source.reason})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
