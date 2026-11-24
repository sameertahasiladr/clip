import { Scissors } from 'lucide-react';

interface HeaderProps {
  hasActiveSession: boolean;
  onReset: () => void;
  onFillDemoUrl: () => void;
}

export function Header({ hasActiveSession, onReset, onFillDemoUrl }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#09090F]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand wordmark */}
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-2.5 text-left text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 rounded-md"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 text-white">
            <Scissors className="h-4 w-4" aria-hidden="true" />
          </span>
          <span style={{ fontFamily: 'var(--font-display)' }}>ClipGenie</span>
        </button>

        {/* Zone 2: Clean single-line text nav links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400"
        >
          <a
            href="#generator"
            className="hover:text-white transition-colors duration-150 whitespace-nowrap shrink-0"
          >
            Generator
          </a>
          <a
            href="#workflow"
            className="hover:text-white transition-colors duration-150 whitespace-nowrap shrink-0"
          >
            How It Works
          </a>
          <a
            href="#formats"
            className="hover:text-white transition-colors duration-150 whitespace-nowrap shrink-0"
          >
            Export Specs
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          {hasActiveSession ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/[0.09] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              New Video
            </button>
          ) : (
            <button
              type="button"
              onClick={onFillDemoUrl}
              className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/[0.09] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              Try Sample Link
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
