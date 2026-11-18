import React from 'react';
import { Plus, X } from 'lucide-react';
import { KidsStage, LifeContext, UpcomingEvent } from '../types/astrology';
import {
  HEALTH_OPTIONS,
  KIDS_OPTIONS,
  MAX_EVENT_LABEL_LENGTH,
  MAX_GOALS_LENGTH,
  MAX_UPCOMING_EVENTS,
  MONEY_OPTIONS,
  RELATIONSHIP_OPTIONS,
  WORK_OPTIONS,
  toggleKidsStage,
} from '../utils/forecastShared';

interface LifeContextFormProps {
  value: LifeContext | undefined;
  onChange: (next: LifeContext) => void;
}

const chipClasses = (active: boolean) =>
  `min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
    active
      ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
      : 'bg-[#080B14] border-slate-800 text-slate-400 hover:text-slate-200'
  }`;

const inputClasses =
  'h-10 px-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400';

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium text-slate-300 mb-1.5">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

/** Optional questions about the user's situation. Every answer can be left empty or taken back. */
export const LifeContextForm: React.FC<LifeContextFormProps> = ({ value, onChange }) => {
  const context = value ?? {};
  const set = (patch: Partial<LifeContext>) => onChange({ ...context, ...patch });

  function single<K extends 'relationship' | 'work' | 'moneyFocus'>(
    key: K,
    options: { value: NonNullable<LifeContext[K]>; label: string }[]
  ) {
    return options.map((option) => {
      const active = context[key] === option.value;
      return (
        <button
          type="button"
          key={option.value}
          aria-pressed={active}
          onClick={() => set({ [key]: active ? undefined : option.value } as Partial<LifeContext>)}
          className={chipClasses(active)}
        >
          {option.label}
        </button>
      );
    });
  }

  function multiple<K extends 'kids' | 'healthFocus'>(
    key: K,
    options: { value: NonNullable<LifeContext[K]>[number]; label: string }[]
  ) {
    const current = (context[key] ?? []) as string[];
    return options.map((option) => {
      const active = current.includes(option.value);
      const next =
        key === 'kids'
          ? toggleKidsStage(current as KidsStage[], option.value as KidsStage)
          : active
          ? current.filter((v) => v !== option.value)
          : [...current, option.value];
      return (
        <button
          type="button"
          key={option.value}
          aria-pressed={active}
          onClick={() => set({ [key]: next } as Partial<LifeContext>)}
          className={chipClasses(active)}
        >
          {option.label}
        </button>
      );
    });
  }

  const flag = (key: 'lookingForPartner' | 'caringForParents', label: string) => (
    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
      <input
        type="checkbox"
        checked={context[key] === true}
        onChange={(e) => set({ [key]: e.target.checked || undefined })}
        className="w-4 h-4 accent-amber-400"
      />
      {label}
    </label>
  );

  const events = context.upcomingEvents ?? [];
  const setEvents = (next: UpcomingEvent[]) => set({ upcomingEvents: next });
  const updateEvent = (index: number, patch: Partial<UpcomingEvent>) =>
    setEvents(events.map((event, i) => (i === index ? { ...event, ...patch } : event)));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Group label="Relationship">{single('relationship', RELATIONSHIP_OPTIONS)}</Group>
        {flag('lookingForPartner', 'I am looking for a partner')}
      </div>

      <Group label="Work">{single('work', WORK_OPTIONS)}</Group>

      <div className="space-y-2">
        <Group label="Children">{multiple('kids', KIDS_OPTIONS)}</Group>
        {flag('caringForParents', 'I look after a parent or an older relative')}
      </div>

      <Group label="Money focus">{single('moneyFocus', MONEY_OPTIONS)}</Group>
      <Group label="Health and wellbeing focus">{multiple('healthFocus', HEALTH_OPTIONS)}</Group>

      <div>
        <label htmlFor="life-goals" className="block text-xs font-medium text-slate-300 mb-1.5">
          What are you working towards right now?
        </label>
        <textarea
          id="life-goals"
          rows={2}
          maxLength={MAX_GOALS_LENGTH}
          value={context.goals ?? ''}
          onChange={(e) => set({ goals: e.target.value })}
          placeholder="For example: find a new job by spring, move in together, run a 10k"
          className="w-full p-3 rounded-xl bg-[#080B14] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
        />
      </div>

      <div>
        <div className="text-xs font-medium text-slate-300 mb-1.5">
          Dates you already know about this month
        </div>
        <div className="space-y-2">
          {events.map((event, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="date"
                aria-label={`Date of event ${index + 1}`}
                value={event.date}
                onChange={(e) => updateEvent(index, { date: e.target.value })}
                className={`${inputClasses} font-mono w-[160px] shrink-0`}
              />
              <input
                type="text"
                aria-label={`Description of event ${index + 1}`}
                value={event.label}
                maxLength={MAX_EVENT_LABEL_LENGTH}
                onChange={(e) => updateEvent(index, { label: e.target.value })}
                placeholder="Interview, moving day, trip"
                className={`${inputClasses} flex-1 min-w-0`}
              />
              <button
                type="button"
                onClick={() => setEvents(events.filter((_, i) => i !== index))}
                aria-label={`Remove event ${index + 1}`}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        {events.length < MAX_UPCOMING_EVENTS && (
          <button
            type="button"
            onClick={() => setEvents([...events, { date: '', label: '' }])}
            className="mt-2 min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add a date
          </button>
        )}
      </div>
    </div>
  );
};
