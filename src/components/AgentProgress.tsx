import React from 'react';
import { Check, Loader2 } from 'lucide-react';

interface AgentProgressProps {
  currentStep: number;
}

const STEPS: { step: number; label: string }[] = [
  { step: 1, label: 'Formulating Deep Queries' },
  { step: 2, label: 'Executing Tavily Ephemeris Web Search' },
  { step: 3, label: 'Grounding Transit Dates & Personal Houses' },
  { step: 4, label: 'Compiling RFC Calendar (.ics)' },
];

export const AgentProgress: React.FC<AgentProgressProps> = ({
  currentStep,
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Forecast generation progress"
      className="rounded-2xl bg-[#10172A] border border-slate-800/80 p-5"
    >
      <ol className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {STEPS.map(({ step, label }) => {
          const isDone = step < currentStep;
          const isActive = step === currentStep;
          return (
            <li
              key={step}
              className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs transition-colors ${
                isActive
                  ? 'bg-violet-500/15 border-violet-400/40 text-violet-100'
                  : isDone
                  ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-200'
                  : 'bg-[#080B14] border-slate-800/80 text-slate-500'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 font-mono text-[11px] ${
                  isActive
                    ? 'bg-violet-500/30 text-violet-100'
                    : isDone
                    ? 'bg-emerald-500/25 text-emerald-200'
                    : 'bg-slate-800 text-slate-500'
                }`}
                aria-hidden="true"
              >
                {isDone ? (
                  <Check className="w-3.5 h-3.5" />
                ) : isActive ? (
                  <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin motion-reduce:animate-none" />
                ) : (
                  step
                )}
              </span>
              <span className="font-medium leading-snug">{label}</span>
              <span className="sr-only">
                {isDone ? ' (done)' : isActive ? ' (in progress)' : ' (pending)'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
