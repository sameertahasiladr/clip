import { useEffect, useState } from 'react';
import {
  Captions,
  Clock,
  Film,
  Minus,
  Plus,
  RectangleHorizontal,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { AudioMode, ClipLength, VideoLayout } from '../types';

export const MIN_CLIP_COUNT = 1;
export const MAX_CLIP_COUNT = 20;

interface OptionsRowProps {
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout: VideoLayout;
  audioMode: AudioMode;
  disabled?: boolean;
  onClipLengthChange: (length: ClipLength) => void;
  onClipCountChange: (count: number) => void;
  onCaptionsChange: (enabled: boolean) => void;
  onVideoLayoutChange: (layout: VideoLayout) => void;
  onAudioModeChange: (mode: AudioMode) => void;
}

const CLIP_LENGTH_OPTIONS: readonly ClipLength[] = [15, 30];

const VIDEO_LAYOUT_OPTIONS: ReadonlyArray<{
  value: VideoLayout;
  label: string;
  description: string;
}> = [
  {
    value: 'vertical-fill',
    label: 'Full Vertical',
    description: '9:16 full-screen vertical crop',
  },
  {
    value: 'vertical-blur',
    label: 'Horizontal in 9:16',
    description: 'Horizontal video centered with blur',
  },
];

const AUDIO_MODE_OPTIONS: ReadonlyArray<{
  value: AudioMode;
  label: string;
  description: string;
}> = [
  {
    value: 'original',
    label: 'Original Audio',
    description: 'Keep the source video audio track',
  },
  {
    value: 'mute',
    label: 'Mute Audio (Shorts Library)',
    description: 'Export silent 4K clips so you can add licensed YouTube Shorts Library music safely',
  },
];

export function OptionsRow({
  clipLength,
  clipCount,
  captions,
  videoLayout,
  audioMode,
  disabled = false,
  onClipLengthChange,
  onClipCountChange,
  onCaptionsChange,
  onVideoLayoutChange,
  onAudioModeChange,
}: OptionsRowProps) {
  const [draftCount, setDraftCount] = useState(String(clipCount));

  useEffect(() => {
    setDraftCount(String(clipCount));
  }, [clipCount]);

  const commitCount = (rawValue: string) => {
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) {
      setDraftCount(String(clipCount));
      return;
    }
    const clamped = Math.min(MAX_CLIP_COUNT, Math.max(MIN_CLIP_COUNT, parsed));
    onClipCountChange(clamped);
    setDraftCount(String(clamped));
  };

  const handleCountInputChange = (rawValue: string) => {
    const digitsOnly = rawValue.replace(/[^\d]/g, '').slice(0, 2);
    setDraftCount(digitsOnly);
    if (!digitsOnly) return;
    const parsed = Number.parseInt(digitsOnly, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_CLIP_COUNT && parsed <= MAX_CLIP_COUNT) {
      onClipCountChange(parsed);
    }
  };

  const stepCount = (delta: number) => {
    const next = Math.min(MAX_CLIP_COUNT, Math.max(MIN_CLIP_COUNT, clipCount + delta));
    onClipCountChange(next);
    setDraftCount(String(next));
  };

  return (
    <div
      className="mt-5 grid grid-cols-1 gap-4 border-t border-white/[0.07] pt-5 sm:grid-cols-2"
      aria-label="Clip generation options"
    >
      {/* 1. Vertical video framing mode: Full Vertical vs Horizontal in 9:16 */}
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Smartphone className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          Vertical video style
        </span>
        <div
          role="group"
          aria-label="Vertical video style"
          className="inline-flex w-full rounded-lg bg-[#0C0C14] p-1 border border-white/[0.08]"
        >
          {VIDEO_LAYOUT_OPTIONS.map((option) => {
            const active = videoLayout === option.value;
            const Icon = option.value === 'vertical-fill' ? Smartphone : RectangleHorizontal;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={option.description}
                onClick={() => onVideoLayoutChange(option.value)}
                className={`flex-1 inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50 ${
                  active
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Clips to generate (direct numeric input + stepper, 1-20) */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="clip-count-input"
          className="flex items-center justify-between text-xs font-medium text-zinc-400"
        >
          <span className="flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
            Clips to generate
          </span>
          <span className="font-mono text-[11px] text-zinc-500">1–{MAX_CLIP_COUNT} clips</span>
        </label>
        <div className="inline-flex h-[46px] w-full items-center rounded-lg border border-white/[0.08] bg-[#0C0C14] p-1">
          <button
            type="button"
            disabled={disabled || clipCount <= MIN_CLIP_COUNT}
            onClick={() => stepCount(-1)}
            aria-label="Decrease number of clips"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-40"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <input
            id="clip-count-input"
            name="clipCount"
            type="number"
            inputMode="numeric"
            min={MIN_CLIP_COUNT}
            max={MAX_CLIP_COUNT}
            step={1}
            disabled={disabled}
            value={draftCount}
            onChange={(e) => handleCountInputChange(e.target.value)}
            onBlur={() => commitCount(draftCount)}
            aria-label="Number of clips to generate"
            className="w-full bg-transparent text-center font-mono text-sm font-semibold tabular-nums text-white focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={disabled || clipCount >= MAX_CLIP_COUNT}
            onClick={() => stepCount(1)}
            aria-label="Increase number of clips"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 3. Clip Length (15s / 30s, default 30s) */}
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Clock className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          Clip length
        </span>
        <div
          role="group"
          aria-label="Clip length"
          className="inline-flex w-full rounded-lg bg-[#0C0C14] p-1 border border-white/[0.08]"
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
                className={`flex-1 min-h-[38px] rounded-md px-4 py-1.5 text-sm font-semibold font-mono tabular-nums transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50 ${
                  active
                    ? 'bg-white/[0.14] text-white'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {length}s
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Add captions toggle (default on) */}
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Captions className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
          English burn-in subtitles
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={captions}
          disabled={disabled}
          onClick={() => onCaptionsChange(!captions)}
          className="inline-flex min-h-[46px] w-full items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#0C0C14] px-3.5 py-2 text-sm font-medium text-zinc-200 hover:border-white/15 transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50"
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

      {/* 5. Audio track copyright mode: Original vs Mute for YouTube Shorts Audio Library */}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
            Audio track (YouTube copyright safety)
          </span>
          <span className="text-[11px] text-zinc-500">
            Mute removes copyrighted music so you can add licensed Shorts Audio Library tracks
          </span>
        </div>
        <div
          role="group"
          aria-label="Audio track mode"
          className="inline-flex w-full rounded-lg bg-[#0C0C14] p-1 border border-white/[0.08]"
        >
          {AUDIO_MODE_OPTIONS.map((option) => {
            const active = audioMode === option.value;
            const Icon = option.value === 'original' ? Volume2 : VolumeX;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={option.description}
                onClick={() => onAudioModeChange(option.value)}
                className={`flex-1 inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50 ${
                  active
                    ? 'bg-white/[0.14] text-white'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
