import type { FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Link2,
  Loader2,
  Music,
  ShieldAlert,
  ShieldCheck,
  VolumeX,
} from 'lucide-react';
import type {
  AudioMode,
  ClipLength,
  SourceCopyrightInfo,
  UploadedAudioTrackResponse,
  VideoLayout,
} from '../types';
import { evaluateYouTubeCopyrightStatus } from '../utils/youtubeMetadata';
import { OptionsRow } from './OptionsRow';

interface HeroFormProps {
  url: string;
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout: VideoLayout;
  audioMode: AudioMode;
  customAudioTrack: UploadedAudioTrackResponse | null;
  isUploadingAudio: boolean;
  audioUploadError: string | null;
  preCheckCopyright: SourceCopyrightInfo | null;
  isCheckingCopyright: boolean;
  preCheckError: string | null;
  connectedChannelId: string | null;
  validationError: string | null;
  isSubmitting: boolean;
  onUrlChange: (value: string) => void;
  onClipLengthChange: (length: ClipLength) => void;
  onClipCountChange: (count: number) => void;
  onCaptionsChange: (enabled: boolean) => void;
  onVideoLayoutChange: (layout: VideoLayout) => void;
  onAudioModeChange: (mode: AudioMode) => void;
  onUploadCustomAudio: (file: File) => void;
  onClearCustomAudio: () => void;
  onCheckCopyright: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function HeroForm({
  url,
  clipLength,
  clipCount,
  captions,
  videoLayout,
  audioMode,
  customAudioTrack,
  isUploadingAudio,
  audioUploadError,
  preCheckCopyright,
  isCheckingCopyright,
  preCheckError,
  connectedChannelId,
  validationError,
  isSubmitting,
  onUrlChange,
  onClipLengthChange,
  onClipCountChange,
  onCaptionsChange,
  onVideoLayoutChange,
  onAudioModeChange,
  onUploadCustomAudio,
  onClearCustomAudio,
  onCheckCopyright,
  onSubmit,
}: HeroFormProps) {
  const preCheckAssessment = preCheckCopyright
    ? evaluateYouTubeCopyrightStatus(
        { ...preCheckCopyright, audioMode },
        connectedChannelId
      )
    : null;

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
          reframe to 4K 9:16 vertical, and export ready-to-post Shorts and Reels.
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
            disabled={isSubmitting || isUploadingAudio}
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

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          {validationError ? (
            <p
              id="youtube-url-error"
              role="alert"
              className="flex items-center gap-2 text-sm text-rose-400"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{validationError}</span>
            </p>
          ) : (
            <p id="youtube-url-hint" className="text-xs text-zinc-500">
              Supports youtube.com/watch, youtu.be, and youtube.com/shorts links up to 360 minutes (6 hours).
            </p>
          )}

          <button
            type="button"
            disabled={isSubmitting || isCheckingCopyright || !url.trim()}
            onClick={onCheckCopyright}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white transition-colors disabled:opacity-45"
          >
            {isCheckingCopyright ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-300" aria-hidden="true" />
                <span>Checking license...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" />
                <span>Check Copyright Before Clipping</span>
              </>
            )}
          </button>
        </div>

        {preCheckError && (
          <p role="alert" className="mt-2.5 flex items-center gap-1.5 text-xs text-rose-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{preCheckError}</span>
          </p>
        )}

        {preCheckCopyright && preCheckAssessment && (
          <div
            data-testid="precheck-copyright-banner"
            className={`mt-3 rounded-xl border p-3.5 ${
              preCheckAssessment.level === 'owned'
                ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
                : preCheckAssessment.level === 'cc-by'
                  ? 'border-sky-500/30 bg-sky-500/[0.07]'
                  : 'border-amber-500/30 bg-amber-500/[0.07]'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {preCheckAssessment.level === 'caution' ? (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              ) : (
                <ShieldCheck
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    preCheckAssessment.level === 'owned' ? 'text-emerald-400' : 'text-sky-400'
                  }`}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-xs font-semibold text-white">
                    {preCheckCopyright.title}
                  </p>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      preCheckAssessment.level === 'owned'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : preCheckAssessment.level === 'cc-by'
                          ? 'bg-sky-500/20 text-sky-200'
                          : 'bg-amber-500/20 text-amber-200'
                    }`}
                  >
                    {preCheckAssessment.badgeLabel}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">
                  Channel: <strong className="text-zinc-100">{preCheckCopyright.channelName}</strong>
                  {preCheckCopyright.category ? ` · ${preCheckCopyright.category}` : ''} —{' '}
                  {preCheckAssessment.summary}
                </p>
                {preCheckCopyright.hasLicensedMusicSignals && audioMode === 'original' && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAudioModeChange('mute')}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/35 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/25 transition-colors"
                    >
                      <VolumeX className="h-3 w-3" aria-hidden="true" />
                      <span>Switch to Mute (Shorts Library)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAudioModeChange('custom-audio')}
                      className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-400/35 bg-fuchsia-500/15 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-100 hover:bg-fuchsia-500/25 transition-colors"
                    >
                      <Music className="h-3 w-3" aria-hidden="true" />
                      <span>Replace with Royalty-Free Audio</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <OptionsRow
          clipLength={clipLength}
          clipCount={clipCount}
          captions={captions}
          videoLayout={videoLayout}
          audioMode={audioMode}
          customAudioTrack={customAudioTrack}
          isUploadingAudio={isUploadingAudio}
          audioUploadError={audioUploadError}
          disabled={isSubmitting}
          onClipLengthChange={onClipLengthChange}
          onClipCountChange={onClipCountChange}
          onCaptionsChange={onCaptionsChange}
          onVideoLayoutChange={onVideoLayoutChange}
          onAudioModeChange={onAudioModeChange}
          onUploadCustomAudio={onUploadCustomAudio}
          onClearCustomAudio={onClearCustomAudio}
        />
      </form>
    </section>
  );
}
