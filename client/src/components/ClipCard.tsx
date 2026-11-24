import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Facebook,
  Instagram,
  X,
  Youtube,
} from 'lucide-react';
import type { ClipItem, SocialPlatform } from '../types';
import {
  buildClipDownloadUrl,
  copyTextToClipboard,
  getClipFilename,
  triggerSynchronousDownload,
} from '../utils/download';
import { formatDuration, getViralityLabel } from '../utils/youtube';
import { VerticalVideoPlayer } from './VerticalVideoPlayer';

interface ClipCardProps {
  clip: ClipItem;
  index: number;
}

const SOCIAL_GUIDES: Record<
  SocialPlatform,
  { label: string; buttonLabel: string; steps: string }
> = {
  youtube: {
    label: 'YouTube Shorts',
    buttonLabel: 'Post to YouTube',
    steps:
      'File downloaded. Open YouTube Studio, click Create -> Upload videos, choose the 9:16 MP4, and paste your copied caption with #Shorts.',
  },
  instagram: {
    label: 'Instagram Reels',
    buttonLabel: 'Post to Instagram',
    steps:
      'File downloaded. Open Instagram, tap + -> Reel, select the saved vertical MP4 from your device, and paste your copied caption.',
  },
  facebook: {
    label: 'Facebook Reels',
    buttonLabel: 'Post to Facebook',
    steps:
      'File downloaded. Open Facebook or Meta Business Suite, choose Create Reel, upload the MP4 file, and paste your copied caption.',
  },
};

export function ClipCard({ clip, index }: ClipCardProps) {
  const [copied, setCopied] = useState(false);
  const [activeGuide, setActiveGuide] = useState<SocialPlatform | null>(null);

  const virality = getViralityLabel(clip.score);
  const downloadUrl = buildClipDownloadUrl(clip);
  const downloadFilename = getClipFilename(clip);
  const hasRange =
    typeof clip.startTime === 'number' &&
    typeof clip.endTime === 'number' &&
    clip.endTime > clip.startTime;

  const handleCopyCaption = async () => {
    const ok = await copyTextToClipboard(clip.caption);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const handleSocialPost = (platform: SocialPlatform) => {
    setActiveGuide((current) => (current === platform ? null : platform));
    triggerSynchronousDownload(clip);
  };

  return (
    <article
      aria-label={`Clip ${index + 1}: ${clip.title}`}
      className="flex flex-col rounded-2xl border border-white/[0.09] bg-[#12121C] transition-colors duration-150 hover:border-white/[0.16]"
    >
      <VerticalVideoPlayer clip={clip} />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
          <span className="font-mono tabular-nums">
            Clip 0{index + 1} · {formatDuration(clip.duration)}
            {hasRange ? ` (${formatDuration(clip.startTime!)}–${formatDuration(clip.endTime!)})` : ''}
          </span>
          <span className={`font-medium ${virality.toneClass}`}>
            {virality.label} ({clip.score}/100)
          </span>
        </div>

        <h3 className="mt-2 text-lg font-semibold leading-snug text-white">
          {clip.title}
        </h3>

        <p className="mt-2.5 line-clamp-3 text-sm leading-relaxed text-zinc-400">
          {clip.caption}
        </p>

        {/* Primary actions: Download MP4 + Copy Caption */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={downloadFilename}
              aria-label={`Download ${clip.title}`}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 px-3.5 py-2 text-xs font-semibold text-white hover:brightness-110 transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-label={`Download ${clip.title}`}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 px-3.5 py-2 text-xs font-semibold text-white opacity-50 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyCaption}
            aria-label={`Copy caption for ${clip.title}`}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/[0.09] transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy Caption</span>
              </>
            )}
          </button>
        </div>

        {/* Social Post Buttons (download + manual upload instructions tooltip) */}
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <p className="mb-2.5 text-xs font-medium text-zinc-500">Quick export &amp; post</p>
          <div className="grid grid-cols-1 gap-2">
            {(
              [
                { id: 'youtube', Icon: Youtube },
                { id: 'instagram', Icon: Instagram },
                { id: 'facebook', Icon: Facebook },
              ] as const
            ).map(({ id, Icon }) => {
              const guide = SOCIAL_GUIDES[id];
              const isOpen = activeGuide === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => handleSocialPost(id)}
                  className={`inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 ${
                    isOpen
                      ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white'
                      : 'border-white/[0.08] bg-[#0B0B13] text-zinc-300 hover:border-white/15 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{guide.buttonLabel}</span>
                </button>
              );
            })}
          </div>

          {activeGuide && (
            <div
              role="tooltip"
              className="mt-3 rounded-xl border border-fuchsia-500/30 bg-[#1A1426] p-3.5 text-xs leading-relaxed text-zinc-200"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-fuchsia-200">
                  {SOCIAL_GUIDES[activeGuide].label} upload steps
                </p>
                <button
                  type="button"
                  onClick={() => setActiveGuide(null)}
                  aria-label="Close upload instructions"
                  className="rounded p-0.5 text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1.5 text-zinc-300">{SOCIAL_GUIDES[activeGuide].steps}</p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
