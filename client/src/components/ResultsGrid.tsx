import { RotateCcw } from 'lucide-react';
import type { ClipItem } from '../types';
import { ClipCard } from './ClipCard';

interface ResultsGridProps {
  clips: ClipItem[];
  sourceUrl: string;
  onReset: () => void;
}

export function ResultsGrid({ clips, sourceUrl, onReset }: ResultsGridProps) {
  return (
    <section aria-label="Generated clips" className="mx-auto max-w-6xl py-8 sm:py-12">
      <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fuchsia-300">
            Ready to publish · {clips.length} {clips.length === 1 ? 'clip' : 'clips'} generated
          </p>
          <h2 className="mt-1.5 text-2xl font-bold text-white sm:text-3xl">
            Your vertical shorts
          </h2>
          <p className="mt-1 truncate text-sm text-zinc-400" title={sourceUrl}>
            From {sourceUrl}
          </p>
        </div>

        <button
          type="button"
          onClick={onReset}
          className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.09] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          <span>Clip Another Video</span>
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-white/[0.08] bg-[#12121C] p-10 text-center">
          <h3 className="text-lg font-semibold text-white">No moments matched your settings</h3>
          <p className="mt-2 text-sm text-zinc-400">
            Try switching to a 15-second clip length or paste a video with spoken dialogue.
          </p>
          <button
            type="button"
            onClick={onReset}
            className="mt-5 inline-flex min-h-[42px] items-center justify-center rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            Try another link
          </button>
        </div>
      ) : (
        <div
          data-testid="results-grid"
          className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {clips.map((clip, index) => (
            <ClipCard key={clip.id} clip={clip} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}
