import React, { useState } from 'react';
import { DailyEnergyForecast, EnergyDimension } from '../types/astrology';
import { ENERGY_DIMENSIONS_METADATA } from '../utils/astrologyEngine';

interface TransitHeatmapMatrixProps {
  forecasts: DailyEnergyForecast[];
  selectedDayIndex: number;
  onSelectDayIndex: (index: number) => void;
  operatingTimezone: string;
}

type HeatmapMetric = 'compositeVitality' | EnergyDimension;

export const TransitHeatmapMatrix: React.FC<TransitHeatmapMatrixProps> = ({
  forecasts,
  selectedDayIndex,
  onSelectDayIndex,
  operatingTimezone,
}) => {
  const [metric, setMetric] = useState<HeatmapMetric>('compositeVitality');
  const [selectedHour, setSelectedHour] = useState<number>(10);

  const inspectedDay = forecasts[selectedDayIndex] || forecasts[0];
  const inspectedSlot = inspectedDay.hours[selectedHour] || inspectedDay.hours[0];

  const getCellStyle = (value: number, currentMetric: HeatmapMetric) => {
    if (currentMetric === 'financialRisk') {
      // High value = high risk (rose/crimson)
      if (value >= 80) return 'bg-rose-500/85 text-white';
      if (value >= 65) return 'bg-rose-500/50 text-rose-100';
      if (value >= 45) return 'bg-amber-500/30 text-amber-200';
      return 'bg-slate-800/60 text-slate-400';
    }

    if (value >= 82) return 'bg-amber-400/85 text-slate-950 font-semibold';
    if (value >= 70) return 'bg-violet-500/65 text-white';
    if (value >= 55) return 'bg-cyan-500/40 text-cyan-100';
    if (value >= 40) return 'bg-slate-800/80 text-slate-300';
    return 'bg-[#0B0F1C] text-slate-500';
  };

  const metricButtons: { id: HeatmapMetric; label: string }[] = [
    { id: 'compositeVitality', label: 'Composite Vitality' },
    { id: 'mental', label: 'Mental Focus' },
    { id: 'physical', label: 'Physical Drive' },
    { id: 'creative', label: 'Creative Spark' },
    { id: 'social', label: 'Social Flow' },
    { id: 'financialRisk', label: 'Financial Caution' },
  ];

  // Sample 12 2-hour blocks or all 24 hours cleanly
  const displayHours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
        <div>
          <div className="text-xs text-slate-400">
            <span>7-Day × 24-Hour Local Transit Matrix</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="font-mono">{operatingTimezone}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
            Weekly Hourly Energy &amp; Caution Heatmap
          </h2>
        </div>

        {/* Metric Selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          {metricButtons.map((btn) => (
            <button
              key={btn.id}
              onClick={() => setMetric(btn.id)}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                metric === btn.id
                  ? btn.id === 'financialRisk'
                    ? 'bg-rose-500/25 border border-rose-400/50 text-rose-200'
                    : 'bg-amber-500/20 border border-amber-400/40 text-amber-200'
                  : 'bg-[#080B14] border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="mt-5 overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Hour Header Row */}
          <div className="grid grid-cols-[110px_repeat(24,minmax(0,1fr))] gap-1 mb-1.5 items-center">
            <div className="text-[11px] font-mono text-slate-500">
              Day / Local Hr
            </div>
            {displayHours.map((hr) => (
              <div
                key={`hdr-${hr}`}
                className={`text-center font-mono text-[10px] ${
                  hr === selectedHour ? 'text-amber-300 font-semibold' : 'text-slate-500'
                }`}
              >
                {String(hr).padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* 7 Day Rows */}
          <div className="space-y-1.5">
            {forecasts.map((day, dIdx) => {
              const isSelectedDay = dIdx === selectedDayIndex;
              return (
                <div
                  key={day.dateIso}
                  className="grid grid-cols-[110px_repeat(24,minmax(0,1fr))] gap-1 items-center"
                >
                  <button
                    onClick={() => onSelectDayIndex(dIdx)}
                    className={`min-h-[34px] text-left px-2 py-1 rounded-lg text-xs font-medium transition-colors truncate cursor-pointer ${
                      isSelectedDay
                        ? 'bg-slate-800 text-amber-300'
                        : 'text-slate-300 hover:bg-slate-800/50'
                    }`}
                  >
                    {day.dayShort}
                  </button>

                  {day.hours.map((slot) => {
                    const val =
                      metric === 'compositeVitality'
                        ? slot.compositeVitality
                        : slot[metric];
                    const isSelectedCell =
                      isSelectedDay && slot.hourLocal === selectedHour;

                    return (
                      <button
                        key={`${day.dateIso}-${slot.hourLocal}`}
                        onClick={() => {
                          onSelectDayIndex(dIdx);
                          setSelectedHour(slot.hourLocal);
                        }}
                        title={`${day.dayShort} ${slot.timeLabelLocal} (${slot.timeLabelUtc}): ${val}% — ${slot.dominantAspect}`}
                        className={`h-8 rounded-md font-mono text-[10px] tabular-nums flex items-center justify-center transition-transform cursor-pointer ${getCellStyle(
                          val,
                          metric
                        )} ${
                          isSelectedCell
                            ? 'ring-2 ring-white scale-105 z-10'
                            : 'hover:opacity-90'
                        }`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend & Inspected Cell Detail */}
      <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="text-xs text-slate-300 space-y-1">
          <div className="text-slate-400">
            <span>Selected Matrix Cell: </span>
            <strong className="text-slate-100">{inspectedDay.dayLabel}</strong>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="font-mono text-amber-300">
              {inspectedSlot.timeLabelLocal} Local
            </span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="font-mono text-violet-300">
              {inspectedSlot.timeLabelUtc}
            </span>
          </div>
          <div>
            <span>Active Transit: </span>
            <span className="text-slate-100 font-medium">
              {inspectedSlot.dominantAspect}
            </span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Ruler: {inspectedSlot.activePlanet}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          {metric === 'financialRisk' ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-slate-800/80 inline-block" />
                Low Caution (&lt;45)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-amber-500/30 inline-block" />
                Moderate (45–64)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-rose-500/85 inline-block" />
                High Caution Window (65+)
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-[#0B0F1C] border border-slate-800 inline-block" />
                Rest / Recovery (&lt;40)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-cyan-500/40 inline-block" />
                Steady Flow (55–69)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-violet-500/65 inline-block" />
                High Alignment (70–81)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-amber-400/85 inline-block" />
                Peak Power Window (82+)
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
