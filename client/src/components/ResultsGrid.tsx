import {
  Link2,
  Music,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  VolumeX,
} from 'lucide-react';
import type {
  ClipItem,
  SocialAccountsState,
  SourceCopyrightInfo,
  YouTubePrivacyStatus,
} from '../types';
import { evaluateYouTubeCopyrightStatus } from '../utils/youtubeMetadata';
import { ClipCard } from './ClipCard';

interface ResultsGridProps {
  clips: ClipItem[];
  jobId: string | null;
  sourceUrl: string;
  sourceCopyright: SourceCopyrightInfo | null;
  socialAccounts: SocialAccountsState | null;
  youtubePrivacy: YouTubePrivacyStatus;
  onReset: () => void;
  onOpenAccounts: () => void;
}

export function ResultsGrid({
  clips,
  jobId,
  sourceUrl,
  sourceCopyright,
  socialAccounts,
  youtubePrivacy,
  onReset,
  onOpenAccounts,
}: ResultsGridProps) {
  const copyrightAssessment = sourceCopyright
    ? evaluateYouTubeCopyrightStatus(sourceCopyright, socialAccounts?.youtube?.channelId)
    : null;

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

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenAccounts}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-fuchsia-500/35 bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            <span>Connect Social Accounts</span>
          </button>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.09] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Clip Another Video</span>
          </button>
        </div>
      </div>

      {sourceCopyright && copyrightAssessment && (
        <div
          data-testid="copyright-summary-banner"
          className={`mt-6 rounded-2xl border p-4 sm:p-5 ${
            copyrightAssessment.level === 'owned'
              ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
              : copyrightAssessment.level === 'cc-by'
                ? 'border-sky-500/30 bg-sky-500/[0.07]'
                : 'border-amber-500/30 bg-amber-500/[0.07]'
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              {copyrightAssessment.level === 'caution' ? (
                <ShieldAlert
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
                  aria-hidden="true"
                />
              ) : (
                <ShieldCheck
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    copyrightAssessment.level === 'owned' ? 'text-emerald-400' : 'text-sky-400'
                  }`}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">
                    YouTube Copyright &amp; License Check
                  </h3>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      copyrightAssessment.level === 'owned'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : copyrightAssessment.level === 'cc-by'
                          ? 'bg-sky-500/20 text-sky-200'
                          : 'bg-amber-500/20 text-amber-200'
                    }`}
                  >
                    {copyrightAssessment.badgeLabel}
                  </span>
                  {sourceCopyright.audioMode === 'mute' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-0.5 text-[11px] font-medium text-zinc-200">
                      <VolumeX className="h-3 w-3 text-fuchsia-300" aria-hidden="true" />
                      Muted for Shorts Audio Library
                    </span>
                  )}
                  {sourceCopyright.audioMode === 'custom-audio' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                      <Music className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                      Royalty-Free Audio Track Applied
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                  {copyrightAssessment.summary}
                </p>
              </div>
            </div>
              <div className="shrink-0 text-xs text-zinc-400 sm:text-right">
              <p className="font-medium text-zinc-200">{sourceCopyright.channelName}</p>
              {sourceCopyright.category && (
                <p className="text-[11px] text-zinc-400">Category: {sourceCopyright.category}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {clips[0]?.sourceHeight && clips[0].sourceHeight < 720 && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-xs leading-relaxed text-amber-100"
        >
          <span className="font-semibold text-amber-200">
            Low-resolution YouTube source detected ({clips[0].sourceWidth ?? '?'}×{clips[0].sourceHeight}):
          </span>{' '}
          Your clip was exported at 4K ({clips[0].width ?? 2160}×{clips[0].height ?? 3840}), but YouTube only served a {clips[0].sourceHeight}p source stream. For crisp native 4K quality, run{' '}
          <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
            yt-dlp -U
          </code>{' '}
          on your local server and restart it, or choose a video uploaded in 1080p/4K.
        </div>
      )}

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
            <ClipCard
              key={clip.id}
              clip={clip}
              index={index}
              jobId={jobId}
              sourceCopyright={sourceCopyright}
              socialAccounts={socialAccounts}
              youtubePrivacy={youtubePrivacy}
              onOpenAccounts={onOpenAccounts}
            />
          ))}
        </div>
      )}
    </section>
  );
}
