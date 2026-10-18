import React, { useMemo, useState } from 'react';
import {
  DailyEnergyForecast,
  EnergyDimension,
  HourlyEnergySlot,
} from '../types/astrology';
import { ENERGY_DIMENSIONS_METADATA } from '../utils/astrologyEngine';

interface EnergyWaveChartProps {
  forecasts: DailyEnergyForecast[];
  selectedDayIndex: number;
  onSelectDayIndex: (index: number) => void;
  operatingTimezone: string;
}

const ALL_DIMENSIONS: EnergyDimension[] = [
  'mental',
  'physical',
  'emotional',
  'creative',
  'social',
  'financialRisk',
];

function createSmoothSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

export const EnergyWaveChart: React.FC<EnergyWaveChartProps> = ({
  forecasts,
  selectedDayIndex,
  onSelectDayIndex,
  operatingTimezone,
}) => {
  const [activeDimensions, setActiveDimensions] = useState<EnergyDimension[]>([
    'mental',
    'physical',
    'creative',
    'financialRisk',
  ]);
  const [scope, setScope] = useState<'daily24h' | 'weekly7d'>('daily24h');
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(10);

  const currentDay = forecasts[selectedDayIndex] || forecasts[0];

  const toggleDimension = (dim: EnergyDimension) => {
    setActiveDimensions((prev) => {
      if (prev.includes(dim)) {
        if (prev.length === 1) return prev; // Keep at least 1 active
        return prev.filter((d) => d !== dim);
      }
      return [...prev, dim];
    });
  };

  // Data series depending on scope
  const dataPoints = useMemo(() => {
    if (scope === 'daily24h') {
      return currentDay.hours.map((slot, idx) => ({
        index: idx,
        label: slot.timeLabelLocal,
        subLabel: `${currentDay.dayShort} · ${slot.timeLabelUtc}`,
        slot,
        dayIndex: selectedDayIndex,
      }));
    } else {
      // Sample every 4 hours across 7 days = 42 points for smooth weekly wave
      const pts: {
        index: number;
        label: string;
        subLabel: string;
        slot: HourlyEnergySlot;
        dayIndex: number;
      }[] = [];
      forecasts.forEach((day, dIdx) => {
        [0, 4, 8, 12, 16, 20].forEach((hr) => {
          const slot = day.hours[hr];
          if (slot) {
            pts.push({
              index: pts.length,
              label: hr === 12 ? day.dayShort : `${String(hr).padStart(2, '0')}:00`,
              subLabel: `${day.dayLabel} · ${slot.timeLabelLocal} (${slot.timeLabelUtc})`,
              slot,
              dayIndex: dIdx,
            });
          }
        });
      });
      return pts;
    }
  }, [scope, currentDay, forecasts, selectedDayIndex]);

  const safeSelectedIndex = Math.min(selectedSlotIndex, dataPoints.length - 1);
  const inspectedPoint = dataPoints[safeSelectedIndex] || dataPoints[0];

  const svgWidth = 880;
  const svgHeight = 270;
  const padLeft = 42;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 34;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const getCoordinates = (dim: EnergyDimension) => {
    return dataPoints.map((pt, idx) => {
      const x =
        padLeft +
        (idx / Math.max(1, dataPoints.length - 1)) * plotWidth;
      const val = pt.slot[dim];
      const y = padTop + plotHeight - (val / 100) * plotHeight;
      return { x, y, val };
    });
  };

  const inspectedX =
    padLeft +
    (safeSelectedIndex / Math.max(1, dataPoints.length - 1)) * plotWidth;

  return (
    <div className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5 sm:p-6">
      {/* Header & Scope Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
        <div>
          <div className="text-xs text-slate-400">
            <span>Multi-Parameter Astrological Wave</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="font-mono">{operatingTimezone}</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>Ruler: {currentDay.chartRulerUsed.sign} ({currentDay.chartRulerUsed.mode})</span>
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-100 mt-1">
            {scope === 'daily24h'
              ? `24-Hour Local Energy Curve — ${currentDay.dayLabel}`
              : '7-Day Weekly Planetary Harmonic Trajectory'}
          </h2>
        </div>

        {/* Segmented Scope Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#080B14] border border-slate-800/80 self-start">
          <button
            onClick={() => {
              setScope('daily24h');
              setSelectedSlotIndex(10);
            }}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              scope === 'daily24h'
                ? 'bg-slate-800 text-amber-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            24h Local Curve
          </button>
          <button
            onClick={() => {
              setScope('weekly7d');
              setSelectedSlotIndex(selectedDayIndex * 6 + 3);
            }}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              scope === 'weekly7d'
                ? 'bg-slate-800 text-amber-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            7-Day Macro Wave
          </button>
        </div>
      </div>

      {/* Interactive Parameter Toggle Bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {ALL_DIMENSIONS.map((dim) => {
          const meta = ENERGY_DIMENSIONS_METADATA[dim];
          const isActive = activeDimensions.includes(dim);
          return (
            <button
              key={dim}
              onClick={() => toggleDimension(dim)}
              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-slate-900/90 border-slate-700 text-slate-100'
                  : 'bg-transparent border-slate-800/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{
                  backgroundColor: isActive ? meta.color : '#334155',
                }}
              />
              <span>{meta.label}</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-400">
                {inspectedPoint.slot[dim]}%
              </span>
            </button>
          );
        })}
      </div>

      {/* SVG Wave Canvas */}
      <div className="mt-5 relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full min-w-[600px] h-auto select-none"
          role="img"
          aria-label="Astrological energy wave chart"
        >
          <defs>
            {ALL_DIMENSIONS.map((dim) => (
              <linearGradient
                key={`grad-${dim}`}
                id={`wave-grad-${dim}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={ENERGY_DIMENSIONS_METADATA[dim].color}
                  stopOpacity="0.22"
                />
                <stop
                  offset="100%"
                  stopColor={ENERGY_DIMENSIONS_METADATA[dim].color}
                  stopOpacity="0.0"
                />
              </linearGradient>
            ))}
          </defs>

          {/* Horizontal Reference Grid Lines */}
          {[0, 25, 50, 75, 100].map((val) => {
            const y = padTop + plotHeight - (val / 100) * plotHeight;
            return (
              <g key={`grid-${val}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgWidth - padRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray={val === 50 ? '4 4' : undefined}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 font-mono text-[10px]"
                >
                  {val}%
                </text>
              </g>
            );
          })}

          {/* Vertical Day / Hour Separators */}
          {dataPoints.map((pt, idx) => {
            const showLabel =
              scope === 'daily24h'
                ? idx % 3 === 0 || idx === 23
                : idx % 6 === 0;
            if (!showLabel) return null;
            const x =
              padLeft +
              (idx / Math.max(1, dataPoints.length - 1)) * plotWidth;
            return (
              <g key={`vgrid-${idx}`}>
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={padTop + plotHeight}
                  stroke="#1E293B"
                  strokeWidth="0.75"
                />
                <text
                  x={x}
                  y={svgHeight - 10}
                  textAnchor="middle"
                  className="fill-slate-400 font-mono text-[10px]"
                >
                  {scope === 'weekly7d'
                    ? forecasts[pt.dayIndex]?.dayShort
                    : pt.label}
                </text>
              </g>
            );
          })}

          {/* Render Spline Area & Stroke for Each Active Dimension */}
          {activeDimensions.map((dim) => {
            const coords = getCoordinates(dim);
            const linePath = createSmoothSvgPath(coords);
            const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + plotHeight).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + plotHeight).toFixed(1)} Z`;
            const color = ENERGY_DIMENSIONS_METADATA[dim].color;
            const isCaution = dim === 'financialRisk';

            return (
              <g key={`series-${dim}`}>
                <path d={areaPath} fill={`url(#wave-grad-${dim})`} />
                <path
                  d={linePath}
                  fill="none"
                  stroke={color}
                  strokeWidth={isCaution ? '2' : '2.5'}
                  strokeDasharray={isCaution ? '5 3' : undefined}
                />
              </g>
            );
          })}

          {/* Active Scrubber Line & Node Dots */}
          <line
            x1={inspectedX}
            y1={padTop}
            x2={inspectedX}
            y2={padTop + plotHeight}
            stroke="#F8FAFC"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          {activeDimensions.map((dim) => {
            const val = inspectedPoint.slot[dim];
            const y = padTop + plotHeight - (val / 100) * plotHeight;
            return (
              <circle
                key={`dot-${dim}`}
                cx={inspectedX}
                cy={y}
                r="4.5"
                fill={ENERGY_DIMENSIONS_METADATA[dim].color}
                stroke="#080B14"
                strokeWidth="2"
              />
            );
          })}

          {/* Interactive Click/Hover Columns */}
          {dataPoints.map((pt, idx) => {
            const colWidth = plotWidth / dataPoints.length;
            const x =
              padLeft +
              (idx / Math.max(1, dataPoints.length - 1)) * plotWidth -
              colWidth / 2;
            return (
              <rect
                key={`hit-${idx}`}
                x={Math.max(padLeft, x)}
                y={padTop}
                width={colWidth}
                height={plotHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setSelectedSlotIndex(idx)}
                onClick={() => {
                  setSelectedSlotIndex(idx);
                  if (scope === 'weekly7d') {
                    onSelectDayIndex(pt.dayIndex);
                  }
                }}
              />
            );
          })}
        </svg>
      </div>

      {/* Selected Time Node Inspector Footer */}
      <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div>
          <div className="text-xs text-slate-400">
            <span>Inspected Window</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="font-mono text-amber-300">{inspectedPoint.subLabel}</span>
          </div>
          <div className="text-sm font-medium text-slate-100 mt-0.5">
            {inspectedPoint.slot.dominantAspect}
          </div>
        </div>

        <div className="text-xs text-slate-400">
          <span>Planetary Hour Ruler: </span>
          <span className="text-slate-200 font-medium">{inspectedPoint.slot.activePlanet}</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>Composite Vitality: </span>
          <span className="font-mono tabular-nums text-emerald-300 font-semibold">
            {inspectedPoint.slot.compositeVitality}/100
          </span>
        </div>

        <div className="flex items-center md:justify-end gap-3 text-xs font-mono tabular-nums">
          <span className="text-slate-400">
            Local: <strong className="text-slate-200">{inspectedPoint.slot.timeLabelLocal}</strong>
          </span>
          <span className="text-slate-600" aria-hidden="true">→</span>
          <span className="text-slate-400">
            Normalized: <strong className="text-violet-300">{inspectedPoint.slot.timeLabelUtc}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
