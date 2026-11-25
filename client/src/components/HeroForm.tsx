import type { FormEvent } from 'react';
import { AlertCircle, ArrowRight, Link2, Loader2 } from 'lucide-react';
import type { ClipLength, VideoLayout } from '../types';
import { OptionsRow } from './OptionsRow';

interface HeroFormProps {
  url: string;
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout: VideoLayout;
  validationError: string | null;
  isSubmitting: boolean;
  onUrlChange: (value: string) => void;
  onClipLengthChange: (length: ClipLength) => void;
  onClipCountChange: (count: number) => void;
  onCaptionsChange: (enabled: boolean) => void;
  onVideoLayoutChange: (layout: VideoLayout) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function HeroForm({
  url,
  clipLength,
  clipCount,
  captions,
  videoLayout,
  validationError,
  isSubmitting,
  onUrlChange,
  onClipLengthChange,
  onClipCountChange,
  onCaptionsChange,
  onVideoLayoutChange,
  onSubmit,
}: HeroFormProps) {
  return (
    <section id="generator" className="mx-auto max-w-4xl pt-12 pb-8 sm:pt-16 sm:pb-12">
      <div className="text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl leading-[1.08]">
          Turn any YouTube video into{' '}
          <span className="bg-gradient-to-r from-purple-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
            viral shorts
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg leading-relaxed">
          Paste a YouTube link and let ClipGenie download the video, find the strongest hooks,
          reframe to 9:16 vertical HD, and export ready-to-post Shorts and Reels.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-9 rounded-2xl border border-white/[0.09] bg-[#12121C] p-5 sm:p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.9)]"
      >
        <label htmlFor="youtube-url-input" className="sr-only">
          YouTube video URL
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <div className="relative flex-1">
            <Link2
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <input
              id="youtube-url-input"
              name="youtubeUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              disabled={isSubmitting}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="Paste a YouTube video link..."
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? 'youtube-url-error' : 'youtube-url-hint'}
              className={`h-13 w-full rounded-xl border bg-[#0A0A12] pl-11 pr-4 text-sm sm:text-base text-white placeholder:text-zinc-500 transition-colors duration-150 focus:outline-none focus:ring-2 ${
                validationError
                  ? 'border-rose-500/70 focus:border-rose-400 focus:ring-rose-500/30'
                  : 'border-white/[0.1] focus:border-fuchsia-400/70 focus:ring-fuchsia-500/25'
              } disabled:opacity-60`}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-13 min-w-[180px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 px-6 text-sm sm:text-base font-semibold text-white shadow-lg shadow-fuchsia-950/40 hover:brightness-110 active:scale-[0.99] transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#12121C] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Starting...</span>
              </>
            ) : (
              <>
                <span>Generate Clips</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>

        {validationError ? (
          <p
            id="youtube-url-error"
            role="alert"
            className="mt-3 flex items-center gap-2 text-sm text-rose-400"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{validationError}</span>
          </p>
        ) : (
          <p id="youtube-url-hint" className="mt-2.5 text-xs text-zinc-500">
            Supports youtube.com/watch, youtu.be, and youtube.com/shorts links up to 60 minutes.
          </p>
        )}

        <OptionsRow
          clipLength={clipLength}
          clipCount={clipCount}
          captions={captions}
          videoLayout={videoLayout}
          disabled={isSubmitting}
          onClipLengthChange={onClipLengthChange}
          onClipCountChange={onClipCountChange}
          onCaptionsChange={onCaptionsChange}
          onVideoLayoutChange={onVideoLayoutChange}
        />
      </form>
    </section>
  );
}
