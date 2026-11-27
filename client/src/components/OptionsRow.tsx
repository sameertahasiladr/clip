import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Captions,
  Clock,
  Film,
  Loader2,
  Minus,
  Music,
  Plus,
  RectangleHorizontal,
  Smartphone,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AudioMode, ClipLength, UploadedAudioTrackResponse, VideoLayout } from '../types';

export const MIN_CLIP_COUNT = 1;
export const MAX_CLIP_COUNT = 20;

interface OptionsRowProps {
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout: VideoLayout;
  audioMode: AudioMode;
  customAudioTrack: UploadedAudioTrackResponse | null;
  isUploadingAudio: boolean;
  audioUploadError: string | null;
  disabled?: boolean;
  onClipLengthChange: (length: ClipLength) => void;
  onClipCountChange: (count: number) => void;
  onCaptionsChange: (enabled: boolean) => void;
  onVideoLayoutChange: (layout: VideoLayout) => void;
  onAudioModeChange: (mode: AudioMode) => void;
  onUploadCustomAudio: (file: File) => void;
  onClearCustomAudio: () => void;
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
    label: 'Mute (Shorts Library)',
    description: 'Export silent 4K clips so you can add licensed YouTube Shorts Library music safely',
  },
  {
    value: 'custom-audio',
    label: 'Replace Audio (Royalty-Free)',
    description: 'Replace source audio with your own royalty-free MP3/WAV/M4A track or voiceover',
  },
];

export function OptionsRow({
  clipLength,
  clipCount,
  captions,
  videoLayout,
  audioMode,
  customAudioTrack,
  isUploadingAudio,
  audioUploadError,
  disabled = false,
  onClipLengthChange,
  onClipCountChange,
  onCaptionsChange,
  onVideoLayoutChange,
  onAudioModeChange,
  onUploadCustomAudio,
  onClearCustomAudio,
}: OptionsRowProps) {
  const [draftCount, setDraftCount] = useState(String(clipCount));
  const audioInputRef = useRef<HTMLInputElement | null>(null);

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

      {/* 5. Audio track copyright mode: Original vs Mute vs Replace with Royalty-Free Audio */}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Volume2 className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
            Audio track (YouTube copyright safety)
          </span>
          <span className="text-[11px] text-zinc-500">
            Mute for Shorts Audio Library or swap in your own royalty-free track
          </span>
        </div>
        <div
          role="group"
          aria-label="Audio track mode"
          className="grid grid-cols-1 gap-1 rounded-lg border border-white/[0.08] bg-[#0C0C14] p-1 sm:grid-cols-3"
        >
          {AUDIO_MODE_OPTIONS.map((option) => {
            const active = audioMode === option.value;
            const Icon =
              option.value === 'original'
                ? Volume2
                : option.value === 'mute'
                  ? VolumeX
                  : Music;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                title={option.description}
                onClick={() => onAudioModeChange(option.value)}
                className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-50 ${
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

        {audioMode === 'custom-audio' && (
          <div className="mt-1 rounded-xl border border-white/[0.09] bg-[#0B0B13] p-3">
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac,audio/webm,.mp3,.wav,.m4a,.ogg,.flac"
              disabled={disabled || isUploadingAudio}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onUploadCustomAudio(file);
                }
                e.target.value = '';
              }}
              className="sr-only"
              aria-label="Upload royalty-free audio track"
            />
            {customAudioTrack ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Music className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span className="truncate text-xs font-medium text-emerald-200">
                    {customAudioTrack.filename}
                  </span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-300">
                    {customAudioTrack.format}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={disabled || isUploadingAudio}
                    onClick={() => audioInputRef.current?.click()}
                    className="rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-white/[0.09] transition-colors"
                  >
                    Change file
                  </button>
                  <button
                    type="button"
                    disabled={disabled || isUploadingAudio}
                    onClick={onClearCustomAudio}
                    aria-label="Remove uploaded audio track"
                    className="rounded-md p-1 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-400">
                  Upload your own royalty-free MP3, WAV, M4A, OGG, or FLAC track (up to 25 MB).
                </p>
                <button
                  type="button"
                  disabled={disabled || isUploadingAudio}
                  onClick={() => audioInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 transition-colors disabled:opacity-50"
                >
                  {isUploadingAudio ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Choose Audio Track</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {audioUploadError && (
              <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-rose-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{audioUploadError}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
