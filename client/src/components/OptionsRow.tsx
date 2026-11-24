import { Captions, Clock, Film } from 'lucide-react';
import type { ClipLength } from '../types';

interface OptionsRowProps {
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  disabled?: boolean;
  onClipLengthChange: (length: ClipLength) => void;
  onClipCountChange: (count: number) => void;
  onCaptionsChange: (enabled: boolean) => void;
}

const CLIP_LENGTH_OPTIONS: readonly ClipLength[] = [15, 30];
const CLIP_COUNT_OPTIONS = [1, 2, 3, 4, 5] as const;

export function OptionsRow({
  clipLength,
  clipCount,
  captions,
  disabled = false,
  onClipLengthChange,
  onClipCountChange,
  onCaptionsChange,
}: OptionsRowProps) {
  return (
    <div
      className="mt-5 grid grid-cols-1 gap-4 border-t border-white/[0.07] pt-5 sm:grid-cols-3 sm:items-center"
      aria-label="Clip generation options"
    >
      {/* Clip Length (15s / 30s, default 30s) */}
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Clock className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          Clip length
        </span>
        <div
          role="group"
          aria-label="Clip length"
          className="inline-flex w-full sm:w-fit rounded-lg bg-[#0C0C14] p-1 border border-white/[0.08]"
        >
          {CLIP_LENGTH_OPTIONS.map((length) => {
            const active = clipLength === length;
            return (
              <button
                key={length}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onClipLengthChange(length)}
                className={`flex-1 sm:flex-initial min-h-[36px] rounded-md px-4 py-1.5 text-sm font-semibold font-mono tabular-nums transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50 ${
                  active
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {length}s
              </button>
            );
          })}
        </div>
      </div>

      {/* Number of clips (1-5, default 3) */}
      <div className="flex flex-col gap-2 sm:items-center">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Film className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          Number of clips
        </span>
        <div
          role="group"
          aria-label="Number of clips"
          className="inline-flex w-full sm:w-fit rounded-lg bg-[#0C0C14] p-1 border border-white/[0.08]"
        >
          {CLIP_COUNT_OPTIONS.map((count) => {
            const active = clipCount === count;
            return (
              <button
                key={count}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onClipCountChange(count)}
                className={`flex-1 sm:flex-initial min-h-[36px] min-w-[38px] rounded-md px-2.5 py-1.5 text-sm font-semibold font-mono tabular-nums transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50 ${
                  active
                    ? 'bg-white/[0.14] text-white'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Add captions toggle (default on) */}
      <div className="flex flex-col gap-2 sm:items-end">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Captions className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          Burn-in subtitles
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={captions}
          disabled={disabled}
          onClick={() => onCaptionsChange(!captions)}
          className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0C0C14] px-3.5 py-2 text-sm font-medium text-zinc-200 hover:border-white/15 transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50"
        >
          <span>Add captions</span>
          <span
            aria-hidden="true"
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
              captions ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${
                captions ? 'translate-x-4.5' : 'translate-x-1'
              }`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
