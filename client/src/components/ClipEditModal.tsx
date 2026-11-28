import { useEffect, useState } from 'react';
import { AlertCircle, Film, Loader2, RotateCcw, Scissors, X } from 'lucide-react';
import type { ClipItem } from '../types';
import { formatDuration, formatTimestamp, parseTimestampInput } from '../utils/youtube';

const MIN_CLIP_SECONDS = 3;
const MAX_CLIP_SECONDS = 180;
const DURATION_PRESETS = [15, 30, 45, 60] as const;

interface ClipEditModalProps {
  isOpen: boolean;
  clip: ClipItem;
  clipNumber: number;
  sourceDuration?: number;
  isRegenerating: boolean;
  error: string | null;
  onClose: () => void;
  onRegenerate: (startTime: number, endTime: number) => void;
}

export function ClipEditModal({
  isOpen,
  clip,
  clipNumber,
  sourceDuration,
  isRegenerating,
  error,
  onClose,
  onRegenerate,
}: ClipEditModalProps) {
  const initialStart = typeof clip.startTime === 'number' && clip.startTime >= 0 ? clip.startTime : 0;
  const initialEnd =
    typeof clip.endTime === 'number' && clip.endTime > initialStart
      ? clip.endTime
      : initialStart + Math.max(MIN_CLIP_SECONDS, clip.duration || 15);

  const [startSeconds, setStartSeconds] = useState<number>(initialStart);
  const [endSeconds, setEndSeconds] = useState<number>(initialEnd);
  const [startText, setStartText] = useState<string>(() => formatTimestamp(initialStart));
  const [endText, setEndText] = useState<string>(() => formatTimestamp(initialEnd));
  const [startInputError, setStartInputError] = useState<string | null>(null);
  const [endInputError, setEndInputError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStartSeconds(initialStart);
    setEndSeconds(initialEnd);
    setStartText(formatTimestamp(initialStart));
    setEndText(formatTimestamp(initialEnd));
    setStartInputError(null);
    setEndInputError(null);
  }, [isOpen, initialStart, initialEnd]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRegenerating) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isRegenerating, onClose]);

  if (!isOpen) return null;

  const hasKnownSourceDuration = typeof sourceDuration === 'number' && sourceDuration > 0;
  const timelineMax = hasKnownSourceDuration
    ? Math.max(sourceDuration, initialEnd)
    : Math.max(initialEnd + 30, 60);

  const clampTimestamp = (value: number): number => {
    const floored = Math.max(0, Number(value.toFixed(1)));
    return hasKnownSourceDuration ? Math.min(sourceDuration, floored) : floored;
  };

  const applyStartValue = (nextValue: number) => {
    const clamped = clampTimestamp(nextValue);
    setStartSeconds(clamped);
    setStartText(formatTimestamp(clamped));
    setStartInputError(null);
  };

  const applyEndValue = (nextValue: number) => {
    const clamped = clampTimestamp(nextValue);
    setEndSeconds(clamped);
    setEndText(formatTimestamp(clamped));
    setEndInputError(null);
  };

  const handleStartTextChange = (raw: string) => {
    setStartText(raw);
    const parsed = parseTimestampInput(raw);
    if (parsed === null) {
      setStartInputError('Use MM:SS or seconds (e.g. 0:15 or 15).');
      return;
    }
    setStartInputError(null);
    setStartSeconds(parsed);
  };

  const handleEndTextChange = (raw: string) => {
    setEndText(raw);
    const parsed = parseTimestampInput(raw);
    if (parsed === null) {
      setEndInputError('Use MM:SS or seconds (e.g. 0:45 or 45).');
      return;
    }
    setEndInputError(null);
    setEndSeconds(parsed);
  };

  const handleStartTextBlur = () => {
    const parsed = parseTimestampInput(startText);
    if (parsed !== null) {
      applyStartValue(parsed);
    }
  };

  const handleEndTextBlur = () => {
    const parsed = parseTimestampInput(endText);
    if (parsed !== null) {
      applyEndValue(parsed);
    }
  };

  const handleApplyPreset = (presetSeconds: number) => {
    const nextEnd = hasKnownSourceDuration
      ? Math.min(sourceDuration, startSeconds + presetSeconds)
      : startSeconds + presetSeconds;
    if (hasKnownSourceDuration && nextEnd - startSeconds < MIN_CLIP_SECONDS) {
      const shiftedStart = Math.max(0, sourceDuration - presetSeconds);
      applyStartValue(shiftedStart);
      applyEndValue(sourceDuration);
      return;
    }
    applyEndValue(nextEnd);
  };

  const handleReset = () => {
    applyStartValue(initialStart);
    applyEndValue(initialEnd);
  };

  const clipDuration = Number((endSeconds - startSeconds).toFixed(1));
  let rangeError: string | null = startInputError || endInputError;

  if (!rangeError) {
    if (startSeconds < 0) {
      rangeError = 'Start time must be 0:00 or later.';
    } else if (endSeconds <= startSeconds) {
      rangeError = 'End time must be after start time.';
    } else if (clipDuration < MIN_CLIP_SECONDS) {
      rangeError = `Clip must be at least ${MIN_CLIP_SECONDS} seconds long.`;
    } else if (clipDuration > MAX_CLIP_SECONDS) {
      rangeError = `Clip cannot exceed ${MAX_CLIP_SECONDS} seconds (3:00).`;
    } else if (hasKnownSourceDuration && endSeconds > sourceDuration + 0.5) {
      rangeError = `End time exceeds source video length (${formatTimestamp(sourceDuration)}).`;
    }
  }

  const isUnchanged =
    Math.abs(startSeconds - initialStart) < 0.05 && Math.abs(endSeconds - initialEnd) < 0.05;
  const canSubmit = !rangeError && !isUnchanged && !isRegenerating;

  const startPct = Math.min(100, Math.max(0, (startSeconds / timelineMax) * 100));
  const endPct = Math.min(100, Math.max(startPct, (endSeconds / timelineMax) * 100));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-edit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRegenerating) {
          onClose();
        }
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#12121C] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300">
              <Scissors className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="clip-edit-modal-title"
                className="truncate text-lg font-bold text-white"
              >
                Edit Clip Timestamps
              </h2>
              <p className="truncate text-xs font-mono tabular-nums text-zinc-400">
                Clip {String(clipNumber).padStart(2, '0')} · Current{' '}
                {formatTimestamp(initialStart)}–{formatTimestamp(initialEnd)}
                {hasKnownSourceDuration ? ` · Source ${formatTimestamp(sourceDuration)}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isRegenerating}
            onClick={onClose}
            aria-label="Close clip timestamp editor"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[176px_1fr]">
            {/* Left: Current clip frame & summary */}
            <div className="flex flex-col items-center sm:items-start">
              <div className="relative aspect-[9/16] w-full max-w-[176px] overflow-hidden rounded-xl border border-white/[0.1] bg-[#07070C]">
                {clip.posterUrl ? (
                  <img
                    src={clip.posterUrl}
                    alt={clip.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
                    <Film className="h-7 w-7 text-zinc-500" aria-hidden="true" />
                    <span className="text-xs text-zinc-400 line-clamp-2">{clip.title}</span>
                  </div>
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 to-transparent"
                />
                <span className="absolute bottom-2 left-2 font-mono text-[11px] font-semibold tabular-nums text-white">
                  {clipDuration > 0 ? formatDuration(clipDuration) : '0:00'}
                </span>
              </div>

              <p className="mt-2.5 line-clamp-2 text-xs font-medium text-zinc-300">
                {clip.title}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Re-cuts only this clip in 4K (2160×3840) and updates its captions.
              </p>
            </div>

            {/* Right: Timeline scrubber & precise controls */}
            <div className="flex flex-col gap-5">
              {/* Visual source timeline bar */}
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="font-medium text-zinc-200">Source timeline</span>
                  <span className="font-mono tabular-nums text-zinc-300">
                    {formatTimestamp(startSeconds)} – {formatTimestamp(endSeconds)} (
                    {clipDuration > 0 ? `${Math.round(clipDuration)}s` : '0s'})
                  </span>
                </div>

                <div className="mt-2.5 relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 transition-all duration-100"
                    style={{
                      left: `${startPct}%`,
                      width: `${Math.max(1.5, endPct - startPct)}%`,
                    }}
                  />
                </div>

                <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-zinc-500">
                  <span>0:00</span>
                  <span>{formatTimestamp(timelineMax / 2)}</span>
                  <span>{formatTimestamp(timelineMax)}</span>
                </div>
              </div>

              {/* Start & End numeric/MM:SS inputs with sliders & fine-tune nudges */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Start time control */}
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="clip-edit-start-input"
                    className="text-xs font-medium text-zinc-300"
                  >
                    Start timestamp
                  </label>
                  <input
                    id="clip-edit-start-input"
                    type="text"
                    inputMode="decimal"
                    disabled={isRegenerating}
                    value={startText}
                    onChange={(e) => handleStartTextChange(e.target.value)}
                    onBlur={handleStartTextBlur}
                    placeholder="0:00"
                    className="w-full rounded-xl border border-white/[0.12] bg-[#0B0B13] px-3.5 py-2.5 font-mono text-sm tabular-nums text-white placeholder-zinc-500 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30 disabled:opacity-50"
                  />
                  <input
                    type="range"
                    min={0}
                    max={timelineMax}
                    step={1}
                    disabled={isRegenerating}
                    value={Math.min(timelineMax, Math.max(0, startSeconds))}
                    aria-label="Adjust start timestamp"
                    onChange={(e) => applyStartValue(Number(e.target.value))}
                    className="w-full accent-fuchsia-500 cursor-pointer disabled:opacity-50"
                  />
                  <div className="flex items-center gap-1.5">
                    {([-5, -1, 1, 5] as const).map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        disabled={isRegenerating}
                        onClick={() => applyStartValue(startSeconds + delta)}
                        className="flex-1 rounded-lg border border-white/[0.1] bg-[#0B0B13] py-1.5 font-mono text-[11px] tabular-nums text-zinc-300 hover:border-white/20 hover:text-white transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                      >
                        {delta > 0 ? `+${delta}s` : `${delta}s`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* End time control */}
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="clip-edit-end-input"
                    className="text-xs font-medium text-zinc-300"
                  >
                    End timestamp
                  </label>
                  <input
                    id="clip-edit-end-input"
                    type="text"
                    inputMode="decimal"
                    disabled={isRegenerating}
                    value={endText}
                    onChange={(e) => handleEndTextChange(e.target.value)}
                    onBlur={handleEndTextBlur}
                    placeholder="0:30"
                    className="w-full rounded-xl border border-white/[0.12] bg-[#0B0B13] px-3.5 py-2.5 font-mono text-sm tabular-nums text-white placeholder-zinc-500 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30 disabled:opacity-50"
                  />
                  <input
                    type="range"
                    min={0}
                    max={timelineMax}
                    step={1}
                    disabled={isRegenerating}
                    value={Math.min(timelineMax, Math.max(0, endSeconds))}
                    aria-label="Adjust end timestamp"
                    onChange={(e) => applyEndValue(Number(e.target.value))}
                    className="w-full accent-fuchsia-500 cursor-pointer disabled:opacity-50"
                  />
                  <div className="flex items-center gap-1.5">
                    {([-5, -1, 1, 5] as const).map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        disabled={isRegenerating}
                        onClick={() => applyEndValue(endSeconds + delta)}
                        className="flex-1 rounded-lg border border-white/[0.1] bg-[#0B0B13] py-1.5 font-mono text-[11px] tabular-nums text-zinc-300 hover:border-white/20 hover:text-white transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                      >
                        {delta > 0 ? `+${delta}s` : `${delta}s`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quick duration presets + Reset */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-4">
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 text-xs text-zinc-400">Set length:</span>
                  {DURATION_PRESETS.map((sec) => {
                    const active = Math.abs(clipDuration - sec) < 0.5;
                    return (
                      <button
                        key={sec}
                        type="button"
                        disabled={isRegenerating}
                        onClick={() => handleApplyPreset(sec)}
                        className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs tabular-nums transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-40 ${
                          active
                            ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-white font-semibold'
                            : 'border-white/[0.1] bg-[#0B0B13] text-zinc-300 hover:border-white/20 hover:text-white'
                        }`}
                      >
                        {sec}s
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={isUnchanged || isRegenerating}
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              </div>

              {/* Inline validation or server error */}
              {(rangeError || error) && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-200"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-rose-400"
                    aria-hidden="true"
                  />
                  <span className="leading-relaxed">{rangeError ?? error}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] px-6 py-4">
          <span className="text-xs font-mono tabular-nums text-zinc-400">
            {isRegenerating
              ? 'Encoding updated 4K vertical clip with FFmpeg...'
              : isUnchanged
                ? 'Adjust start or end time to regenerate'
                : `New range: ${formatTimestamp(startSeconds)} – ${formatTimestamp(endSeconds)} (${Math.round(clipDuration)}s)`}
          </span>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isRegenerating}
              onClick={onClose}
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/[0.09] transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => onRegenerate(startSeconds, endSeconds)}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 px-4 py-2 text-xs font-semibold text-white hover:brightness-110 transition-all whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Regenerating Clip...</span>
                </>
              ) : (
                <>
                  <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Regenerate Clip</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
