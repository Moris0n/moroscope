import React, { useEffect, useMemo, useState } from 'react';
import {
  ForecastResult,
  LifePriority,
} from '../types/astrology';
import {
  LIFE_PRIORITIES,
  PRIORITY_LABELS,
  parseMonthRange,
} from '../utils/forecastShared';
import {
  buildMonthlyHeatmap,
  impactBadgeClasses,
} from '../utils/forecastHelpers';

interface TransitHeatmapMatrixProps {
  result: ForecastResult | null;
  targetMonth: string;
  priorities: LifePriority[];
}

interface SelectedCell {
  priority: LifePriority;
  date: string;
}

export const TransitHeatmapMatrix: React.FC<TransitHeatmapMatrixProps> = ({
  result,
  targetMonth,
  priorities,
}) => {
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const range = useMemo(() => parseMonthRange(targetMonth), [targetMonth]);
  const rows = priorities.length > 0 ? priorities : LIFE_PRIORITIES;
  const matrix = useMemo(
    () =>
      range && result ? buildMonthlyHeatmap(result.events, range, rows) : null,
    [result, range, rows]
  );

  useEffect(() => {
    setSelected(null);
  }, [result, targetMonth, priorities]);

  const dayHeaders = range
    ? Array.from({ length: range.daysInMonth }, (_, i) => i + 1)
    : [];

  const selectedCell = useMemo(() => {
    if (!selected || !matrix) return null;
    const rIdx = rows.indexOf(selected.priority);
    if (rIdx < 0) return null;
    return (
      matrix[rIdx].find((c) => c.date === selected.date) || null
    );
  }, [selected, matrix, rows]);

  return (
    <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
        <div>
          <div className="text-xs text-slate-400">
            <span>Monthly Day-by-Topic Transit Matrix</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="font-mono text-amber-300">{targetMonth}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
            Sourced Monthly Event Heatmap
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-emerald-500/60 inline-block" />
            Opportunity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500/60 inline-block" />
            Caution
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-violet-500/60 inline-block" />
            Milestone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-gradient-to-br from-emerald-500/40 via-amber-500/40 to-violet-500/40 inline-block" />
            Mixed
          </span>
        </div>
      </div>

      {!matrix || !result ? (
        <div className="mt-6 py-10 text-center space-y-2">
          <p className="text-sm text-slate-300 font-medium">
            No generated forecast yet for {targetMonth}.
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Generate a forecast from the Dashboard. Every colored
            cell below maps to a source-backed event — empty cells simply mean no
            sourced event covers that day, not an unfavorable one.
          </p>
        </div>
      ) : (
        <>
          {result.events.length === 0 && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-[#080B14] border border-slate-800/90 text-xs text-slate-400">
              No adequately dated, source-backed events were found for this
              month — all cells are intentionally empty. See the theme summary
              for the evidence gap.
            </div>
          )}

          <div className="mt-5 overflow-x-auto">
            <div className="min-w-[900px]">
              <div
                className="grid gap-1 mb-1.5 items-center"
                style={{
                  gridTemplateColumns: `150px repeat(${range!.daysInMonth}, minmax(0,1fr))`,
                }}
              >
                <div className="text-[11px] font-mono text-slate-500">
                  Topic / Day
                </div>
                {dayHeaders.map((d) => (
                  <div
                    key={`hdr-${d}`}
                    className="text-center font-mono text-[10px] text-slate-500"
                  >
                    {String(d).padStart(2, '0')}
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                {priorities.length === 0 && (
                  <p className="text-xs text-slate-500 py-2">
                    No life priorities selected — showing all five topic rows.
                  </p>
                )}
                {matrix.map((row, rIdx) => {
                  const priority = rows[rIdx];
                  return (
                    <div
                      key={priority}
                      className="grid gap-1 items-center"
                      style={{
                        gridTemplateColumns: `150px repeat(${range!.daysInMonth}, minmax(0,1fr))`,
                      }}
                    >
                      <div className="text-xs font-medium text-slate-300 truncate pr-2">
                        {PRIORITY_LABELS[priority]}
                      </div>
                      {row.map((cell) => {
                        const isSelected =
                          selected?.priority === priority &&
                          selected.date === cell.date;
                        const classes =
                          cell.impacts.size === 0
                            ? 'bg-[#0B0F1C] text-slate-600'
                            : cell.impacts.size > 1
                            ? 'bg-gradient-to-br from-emerald-500/40 via-amber-500/40 to-violet-500/40 text-white font-semibold'
                            : cell.impacts.has('Opportunity')
                            ? 'bg-emerald-500/60 text-emerald-50'
                            : cell.impacts.has('Caution')
                            ? 'bg-amber-500/60 text-amber-50'
                            : 'bg-violet-500/60 text-violet-50';
                        const impactDesc =
                          cell.impacts.size === 0
                            ? 'No sourced event'
                            : cell.impacts.size > 1
                            ? `Mixed: ${[...cell.impacts].join(' & ')}`
                            : [...cell.impacts][0];
                        return (
                          <button
                            key={cell.date}
                            onClick={() =>
                              setSelected({ priority, date: cell.date })
                            }
                            aria-label={`${PRIORITY_LABELS[priority]} on ${cell.date}: ${impactDesc}`}
                            title={`${cell.date} — ${impactDesc}`}
                            className={`h-8 rounded-md font-mono text-[10px] tabular-nums flex items-center justify-center transition-transform cursor-pointer ${classes} ${
                              isSelected
                                ? 'ring-2 ring-white scale-105 z-10'
                                : 'hover:opacity-90'
                            }`}
                          >
                            {cell.impacts.size > 1 ? '◆' : ''}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800/80">
            {selected && selectedCell && selectedCell.events.length > 0 ? (
              <div className="space-y-3">
                <div className="text-xs text-slate-400">
                  <span className="text-amber-300 font-medium">
                    {PRIORITY_LABELS[selected.priority]}
                  </span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span className="font-mono">{selected.date}</span>
                </div>
                {selectedCell.events.map((ev, i) => (
                  <div
                    key={`${ev.date}-${i}`}
                    className="p-3 rounded-xl bg-[#080B14] border border-slate-800/90"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${impactBadgeClasses(
                          ev.impact_type
                        )}`}
                      >
                        {ev.impact_type}
                      </span>
                      <span className="font-mono text-slate-400">
                        {ev.date}
                        {ev.end_date ? ` → ${ev.end_date}` : ''}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 mt-1.5">
                      {ev.title}
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {ev.summary}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {ev.source_urls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-cyan-300 hover:underline font-mono truncate max-w-[280px]"
                        >
                          {url}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : selected ? (
              <p className="text-xs text-slate-400">
                <span className="text-amber-300 font-medium">
                  {PRIORITY_LABELS[selected.priority]}
                </span>
                <span className="mx-2" aria-hidden="true">·</span>
                <span className="font-mono">{selected.date}</span> — No
                sourced event covers this day.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Select a day cell to inspect the source-backed events covering
                it. Multi-impact days are marked ◆.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};
