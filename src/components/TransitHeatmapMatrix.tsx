import React, { useEffect, useMemo, useState } from 'react';
import {
  ForecastResult,
  LifeArea,
} from '../types/astrology';
import {
  EVENT_TYPE_LABELS,
  LIFE_AREAS,
  LIFE_AREA_LABELS,
  parseMonthRange,
} from '../utils/forecastShared';
import {
  buildMonthlyHeatmap,
  eventTypeBadgeClasses,
} from '../utils/forecastHelpers';

interface TransitHeatmapMatrixProps {
  result: ForecastResult | null;
  targetMonth: string;
  areas: LifeArea[]; // the chosen focus areas; none means all of them
}

interface SelectedCell {
  area: LifeArea;
  date: string;
}

export const TransitHeatmapMatrix: React.FC<TransitHeatmapMatrixProps> = ({
  result,
  targetMonth,
  areas,
}) => {
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const range = useMemo(() => parseMonthRange(targetMonth), [targetMonth]);
  const rows = areas.length > 0 ? areas : LIFE_AREAS;
  const matrix = useMemo(
    () =>
      range && result ? buildMonthlyHeatmap(result.events, range, rows) : null,
    [result, range, rows]
  );

  useEffect(() => {
    setSelected(null);
  }, [result, targetMonth, areas]);

  const dayHeaders = range
    ? Array.from({ length: range.daysInMonth }, (_, i) => i + 1)
    : [];

  const selectedCell = useMemo(() => {
    if (!selected || !matrix) return null;
    const rIdx = rows.indexOf(selected.area);
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
            <span>Month map: life areas by day</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="font-mono text-amber-300">{targetMonth}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
            Sourced Events by Life Area
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-emerald-500/60 inline-block" />
            {EVENT_TYPE_LABELS.goodTime}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-amber-500/60 inline-block" />
            {EVENT_TYPE_LABELS.caution}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-violet-500/60 inline-block" />
            {EVENT_TYPE_LABELS.keyDate}
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
                  Life area / Day
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
                {areas.length === 0 && (
                  <p className="text-xs text-slate-500 py-2">
                    No focus areas chosen — showing all ten life areas.
                  </p>
                )}
                {matrix.map((row, rIdx) => {
                  const area = rows[rIdx];
                  return (
                    <div
                      key={area}
                      className="grid gap-1 items-center"
                      style={{
                        gridTemplateColumns: `150px repeat(${range!.daysInMonth}, minmax(0,1fr))`,
                      }}
                    >
                      <div className="text-xs font-medium text-slate-300 truncate pr-2">
                        {LIFE_AREA_LABELS[area]}
                      </div>
                      {row.map((cell) => {
                        const isSelected =
                          selected?.area === area &&
                          selected.date === cell.date;
                        const classes =
                          cell.types.size === 0
                            ? 'bg-[#0B0F1C] text-slate-600'
                            : cell.types.size > 1
                            ? 'bg-gradient-to-br from-emerald-500/40 via-amber-500/40 to-violet-500/40 text-white font-semibold'
                            : cell.types.has('goodTime')
                            ? 'bg-emerald-500/60 text-emerald-50'
                            : cell.types.has('caution')
                            ? 'bg-amber-500/60 text-amber-50'
                            : 'bg-violet-500/60 text-violet-50';
                        const impactDesc =
                          cell.types.size === 0
                            ? 'No sourced event'
                            : cell.types.size > 1
                            ? `Mixed: ${[...cell.types].map((t) => EVENT_TYPE_LABELS[t]).join(' & ')}`
                            : EVENT_TYPE_LABELS[[...cell.types][0]];
                        return (
                          <button
                            key={cell.date}
                            onClick={() =>
                              setSelected({ area, date: cell.date })
                            }
                            aria-label={`${LIFE_AREA_LABELS[area]} on ${cell.date}: ${impactDesc}`}
                            title={`${cell.date} — ${impactDesc}`}
                            className={`h-8 rounded-md font-mono text-[10px] tabular-nums flex items-center justify-center transition-transform cursor-pointer ${classes} ${
                              isSelected
                                ? 'ring-2 ring-white scale-105 z-10'
                                : 'hover:opacity-90'
                            }`}
                          >
                            {cell.types.size > 1 ? '◆' : ''}
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
                    {LIFE_AREA_LABELS[selected.area]}
                  </span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span className="font-mono">{selected.date}</span>
                </div>
                {selectedCell.events.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-xl bg-[#080B14] border border-slate-800/90"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${eventTypeBadgeClasses(
                          ev.type
                        )}`}
                      >
                        {EVENT_TYPE_LABELS[ev.type]}
                      </span>
                      <span className="font-mono text-slate-400">
                        {ev.date}
                        {ev.endDate ? ` → ${ev.endDate}` : ''}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 mt-1.5">
                      {ev.title}
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {ev.summary}
                    </p>
                    {ev.personalNote && (
                      <p className="text-xs text-slate-200 mt-1.5 leading-relaxed">
                        <span className="text-amber-300 font-medium">For you: </span>
                        {ev.personalNote}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {ev.sourceUrls.map((url) => (
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
                  {LIFE_AREA_LABELS[selected.area]}
                </span>
                <span className="mx-2" aria-hidden="true">·</span>
                <span className="font-mono">{selected.date}</span> — No
                sourced event covers this day.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Select a day cell to inspect the source-backed events covering
                it. Days with more than one kind of event are marked ◆.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};
