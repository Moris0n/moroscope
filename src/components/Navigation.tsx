import React from 'react';
import { LucideIcon, Radio, Sparkles, UserCheck } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type ActiveTab = 'dashboard' | 'sources' | 'profile';

const TABS: { id: ActiveTab; label: string; mobileLabel: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Dashboard', icon: Sparkles },
  { id: 'sources', label: 'Sources', mobileLabel: 'Sources', icon: Radio },
  { id: 'profile', label: 'Natal Profile', mobileLabel: 'Profile & TZ', icon: UserCheck },
];

interface NavigationProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}

export const AppHeader: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => (
  <header className="sticky top-0 z-30 bg-[#080B14]/90 backdrop-blur-md border-b border-slate-800/80">
    <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 h-14">
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectTab('dashboard');
        }}
        className="text-lg font-bold tracking-tight text-amber-300 font-display whitespace-nowrap shrink-0"
      >
        Moroscope
      </a>

      <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`hover:text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === tab.id
                ? 'text-amber-300 underline underline-offset-8 decoration-amber-400'
                : ''
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-2.5 shrink-0">
        <PWAInstallButton />
        <button
          onClick={() => onSelectTab('profile')}
          className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          Calibrate Chart
        </button>
      </div>
    </div>
  </header>
);

export const MobileNav: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => (
  <nav
    aria-label="Mobile bottom navigation"
    className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080B14]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-3 items-center h-16 px-2"
  >
    {TABS.map(({ id, mobileLabel, icon: Icon }) => (
      <button
        key={id}
        onClick={() => onSelectTab(id)}
        className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
          activeTab === id ? 'text-amber-300' : 'text-slate-400'
        }`}
      >
        <Icon className="w-5 h-5" />
        <span className="text-[10px] font-medium tracking-tight mt-1">
          {mobileLabel}
        </span>
      </button>
    ))}
  </nav>
);
