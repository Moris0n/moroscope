import React from 'react';
import { ZodiacSign } from '../types/astrology';
import { ZODIAC_METADATA, ZODIAC_SIGNS } from '../utils/astrologyEngine';

interface SignPickerProps {
  value: ZodiacSign | null;
  onChange: (sign: ZodiacSign) => void;
}

export const SignPicker: React.FC<SignPickerProps> = ({ value, onChange }) => (
  <div role="radiogroup" aria-label="Zodiac sign" className="grid grid-cols-3 sm:grid-cols-4 gap-2">
    {ZODIAC_SIGNS.map((sign) => {
      const meta = ZODIAC_METADATA[sign];
      const selected = value === sign;
      return (
        <button
          type="button"
          key={sign}
          role="radio"
          aria-checked={selected}
          onClick={() => onChange(sign)}
          className={`min-h-[64px] px-2 py-2 rounded-xl border text-center transition-colors cursor-pointer ${
            selected
              ? 'bg-amber-500/20 border-amber-400/60 text-amber-100'
              : 'bg-[#080B14] border-slate-800 text-slate-300 hover:border-slate-600'
          }`}
        >
          <span className="block text-xl font-display" aria-hidden="true">
            {meta.glyph}
          </span>
          <span className="block text-xs font-semibold">{sign}</span>
          <span className="block text-[10px] text-slate-500">{meta.dateRange}</span>
        </button>
      );
    })}
  </div>
);
