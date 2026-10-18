import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="min-h-[40px] px-3.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Install CelestialPulse as a standalone PWA"
      >
        <Download className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Install CelestialPulse on your device"
      >
        <Smartphone className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="hidden sm:inline">{isIOS ? 'Install on iOS' : 'PWA Guide'}</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#10172A] border border-slate-800 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h3 className="text-base font-semibold text-slate-100">
                Install CelestialPulse PWA
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-300 leading-relaxed">
              <p>
                CelestialPulse is a serverless-ready Progressive Web App with full offline ephemeris &amp; timezone caching.
              </p>
              {isIOS ? (
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
                  <p className="font-medium text-amber-300">iPhone / iPad Installation:</p>
                  <p>1. Tap the <strong>Share</strong> button in your Safari toolbar.</p>
                  <p>2. Scroll down and select <strong>Add to Home Screen</strong>.</p>
                  <p>3. Launch CelestialPulse directly from your home screen in standalone mode.</p>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
                  <p className="font-medium text-amber-300">Desktop &amp; Android Installation:</p>
                  <p>1. Click the <strong>Install</strong> icon in your browser&apos;s address bar (or open the browser menu and select <strong>Install CelestialPulse</strong>).</p>
                  <p>2. If viewing inside an embedded preview frame, open the app in a dedicated browser tab to trigger one-click home screen installation.</p>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowModal(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
