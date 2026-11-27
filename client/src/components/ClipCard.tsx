import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Facebook,
  Instagram,
  Link2,
  Loader2,
  Pencil,
  X,
  Youtube,
} from 'lucide-react';
import { ApiError, publishClipToSocial } from '../api';
import type {
  ClipItem,
  PublishClipResponse,
  SocialAccountsState,
  SocialPlatform,
  SourceCopyrightInfo,
  YouTubeLicenseType,
  YouTubePrivacyStatus,
} from '../types';
import {
  buildClipDownloadUrl,
  copyTextToClipboard,
  getClipFilename,
  triggerSynchronousDownload,
} from '../utils/download';
import { formatDuration, getViralityLabel } from '../utils/youtube';
import {
  buildDefaultYouTubeDescription,
  buildDefaultYouTubeTitle,
} from '../utils/youtubeMetadata';
import { VerticalVideoPlayer } from './VerticalVideoPlayer';
import { YouTubePublishModal } from './YouTubePublishModal';

interface ClipCardProps {
  clip: ClipItem;
  index: number;
  jobId: string | null;
  sourceCopyright: SourceCopyrightInfo | null;
  socialAccounts: SocialAccountsState | null;
  youtubePrivacy: YouTubePrivacyStatus;
  onOpenAccounts: () => void;
}

const SOCIAL_GUIDES: Record<
  SocialPlatform,
  { label: string; buttonLabel: string; steps: string }
> = {
  youtube: {
    label: 'YouTube Shorts',
    buttonLabel: 'Post to YouTube',
    steps:
      'File downloaded. Connect your YouTube channel above for 1-click upload, or open YouTube Studio -> Upload videos and choose this 9:16 MP4.',
  },
  instagram: {
    label: 'Instagram Reels',
    buttonLabel: 'Post to Instagram',
    steps:
      'File downloaded. Connect your Instagram Business/Creator account above for 1-click Reels publishing, or upload manually via the Instagram app.',
  },
  facebook: {
    label: 'Facebook Reels',
    buttonLabel: 'Post to Facebook',
    steps:
      'File downloaded. Connect your Facebook Page above for 1-click Reels publishing, or upload manually via Meta Business Suite.',
  },
};

export function ClipCard({
  clip,
  index,
  jobId,
  sourceCopyright,
  socialAccounts,
  youtubePrivacy,
  onOpenAccounts,
}: ClipCardProps) {
  const [copied, setCopied] = useState(false);
  const [activeGuide, setActiveGuide] = useState<SocialPlatform | null>(null);
  const [publishingPlatform, setPublishingPlatform] = useState<SocialPlatform | null>(null);
  const [publishedResults, setPublishedResults] = useState<
    Partial<Record<SocialPlatform, PublishClipResponse>>
  >({});
  const [publishError, setPublishError] = useState<string | null>(null);

  // Editable YouTube Shorts metadata (100-char title with hashtags + 5000-char description with viral hashtags)
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState(() => buildDefaultYouTubeTitle(clip.title));
  const [youtubeDescription, setYoutubeDescription] = useState(() =>
    buildDefaultYouTubeDescription(clip.title, clip.caption, clip.captionCues)
  );
  const [clipYoutubePrivacy, setClipYoutubePrivacy] =
    useState<YouTubePrivacyStatus>(youtubePrivacy);
  const [clipYoutubeLicense, setClipYoutubeLicense] = useState<YouTubeLicenseType>(() =>
    sourceCopyright?.sourceLicense === 'creativeCommon' ? 'creativeCommon' : 'youtube'
  );

  useEffect(() => {
    setClipYoutubePrivacy(youtubePrivacy);
  }, [youtubePrivacy]);

  const virality = getViralityLabel(clip.score);
  const downloadUrl = buildClipDownloadUrl(clip);
  const downloadFilename = getClipFilename(clip);
  const hasRange =
    typeof clip.startTime === 'number' &&
    typeof clip.endTime === 'number' &&
    clip.endTime > clip.startTime;

  const isPlatformConnected = (platform: SocialPlatform): boolean => {
    if (!socialAccounts) return false;
    if (platform === 'youtube') return Boolean(socialAccounts.youtube);
    if (platform === 'facebook') return Boolean(socialAccounts.facebook);
    return Boolean(socialAccounts.instagram);
  };

  const getConnectedAccountLabel = (platform: SocialPlatform): string | null => {
    if (!socialAccounts) return null;
    if (platform === 'youtube' && socialAccounts.youtube) {
      return socialAccounts.youtube.channelTitle;
    }
    if (platform === 'facebook' && socialAccounts.facebook) {
      return socialAccounts.facebook.pageName;
    }
    if (platform === 'instagram' && socialAccounts.instagram) {
      return `@${socialAccounts.instagram.username}`;
    }
    return null;
  };

  const handleCopyCaption = async () => {
    const ok = await copyTextToClipboard(youtubeDescription);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  const executePublish = async (
    platform: SocialPlatform,
    overrides?: {
      title: string;
      caption: string;
      privacyStatus?: YouTubePrivacyStatus;
      license?: YouTubeLicenseType;
    }
  ) => {
    if (!jobId) return;
    setPublishError(null);
    setActiveGuide(null);
    setPublishingPlatform(platform);
    try {
      const result = await publishClipToSocial({
        platform,
        jobId,
        clipIndex: index + 1,
        title: overrides?.title ?? (platform === 'youtube' ? youtubeTitle : clip.title),
        caption: overrides?.caption ?? youtubeDescription,
        privacyStatus:
          platform === 'youtube' ? (overrides?.privacyStatus ?? clipYoutubePrivacy) : undefined,
        license:
          platform === 'youtube' ? (overrides?.license ?? clipYoutubeLicense) : undefined,
      });
      setPublishedResults((prev) => ({ ...prev, [platform]: result }));
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : `Could not publish to ${SOCIAL_GUIDES[platform].label}.`;
      setPublishError(message);
    } finally {
      setPublishingPlatform(null);
    }
  };

  const handleSocialPost = async (platform: SocialPlatform) => {
    setPublishError(null);

    // For YouTube, open the Details editor modal so user can edit 100-char title & 5000-char description with viral hashtags before uploading
    if (platform === 'youtube') {
      if (isPlatformConnected('youtube') && jobId) {
        setActiveGuide(null);
        setIsYouTubeModalOpen(true);
        return;
      }
      setActiveGuide((current) => (current === platform ? null : platform));
      triggerSynchronousDownload(clip);
      return;
    }

    if (isPlatformConnected(platform) && jobId) {
      await executePublish(platform);
      return;
    }

    // Fallback when account isn't connected yet: download clip & show Connect + manual instructions
    setActiveGuide((current) => (current === platform ? null : platform));
    triggerSynchronousDownload(clip);
  };

  return (
    <article
      aria-label={`Clip ${index + 1}: ${youtubeTitle}`}
      className="flex flex-col rounded-2xl border border-white/[0.09] bg-[#12121C] transition-colors duration-150 hover:border-white/[0.16]"
    >
      <VerticalVideoPlayer clip={clip} />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="font-mono tabular-nums">
              Clip {String(index + 1).padStart(2, '0')} · {formatDuration(clip.duration)}
              {hasRange ? ` (${formatDuration(clip.startTime!)}–${formatDuration(clip.endTime!)})` : ''}
            </span>
            {clip.width && clip.height ? (
              <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-fuchsia-200 border border-fuchsia-400/25">
                {clip.width >= 2160 || clip.height >= 3840
                  ? `4K · ${clip.width}×${clip.height}`
                  : `${clip.width}×${clip.height}`}
              </span>
            ) : null}
          </div>
          <span className={`font-medium ${virality.toneClass}`}>
            {virality.label} ({clip.score}/100)
          </span>
        </div>

        <h3 className="mt-2 text-lg font-semibold leading-snug text-white">
          {youtubeTitle}
        </h3>

        <p className="mt-2.5 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-zinc-400">
          {youtubeDescription}
        </p>

        <button
          type="button"
          onClick={() => {
            setPublishError(null);
            setIsYouTubeModalOpen(true);
          }}
          className="mt-3 inline-flex items-center gap-1.5 self-start rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-fuchsia-300 hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-fuchsia-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Edit YouTube Title &amp; Description</span>
        </button>

        {/* Primary actions: Download MP4 + Copy Description */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
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
            aria-label={`Copy description for ${clip.title}`}
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

        {/* Social Post Buttons (direct publish when connected; download + connect guide otherwise) */}
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-500">Publish to social</p>
            <button
              type="button"
              onClick={onOpenAccounts}
              className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200 transition-colors"
            >
              Manage accounts
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {(
              [
                { id: 'youtube', Icon: Youtube },
                { id: 'instagram', Icon: Instagram },
                { id: 'facebook', Icon: Facebook },
              ] as const
            ).map(({ id, Icon }) => {
              const guide = SOCIAL_GUIDES[id];
              const connected = isPlatformConnected(id);
              const accountLabel = getConnectedAccountLabel(id);
              const isPublishing = publishingPlatform === id;
              const published = publishedResults[id];
              const isOpen = activeGuide === id;

              if (published) {
                return (
                  <a
                    key={id}
                    href={published.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[38px] w-full items-center justify-between gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 transition-colors"
                  >
                    <span className="inline-flex items-center gap-2 truncate">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                      <span className="truncate">Posted to {published.accountLabel}</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </a>
                );
              }

              return (
                <button
                  key={id}
                  type="button"
                  disabled={publishingPlatform !== null}
                  aria-expanded={!connected ? isOpen : undefined}
                  onClick={() => void handleSocialPost(id)}
                  className={`inline-flex min-h-[38px] w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:opacity-60 ${
                    connected
                      ? 'border-fuchsia-500/30 bg-fuchsia-500/10 text-white hover:bg-fuchsia-500/20'
                      : isOpen
                        ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white'
                        : 'border-white/[0.08] bg-[#0B0B13] text-zinc-300 hover:border-white/15 hover:text-white'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 truncate">
                    {isPublishing ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-fuchsia-300" aria-hidden="true" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate">
                      {isPublishing ? `Publishing to ${guide.label}...` : guide.buttonLabel}
                    </span>
                  </span>
                  {connected && accountLabel ? (
                    <span className="max-w-[110px] truncate rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {accountLabel}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500 shrink-0">Not linked</span>
                  )}
                </button>
              );
            })}
          </div>

          {publishError && !isYouTubeModalOpen && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
              <span className="leading-relaxed">{publishError}</span>
            </div>
          )}

          {activeGuide && (
            <div
              role="tooltip"
              className="mt-3 rounded-xl border border-fuchsia-500/30 bg-[#1A1426] p-3.5 text-xs leading-relaxed text-zinc-200"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-fuchsia-200">
                  {SOCIAL_GUIDES[activeGuide].label}
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
              <button
                type="button"
                onClick={() => {
                  setActiveGuide(null);
                  onOpenAccounts();
                }}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 transition-all"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Connect for 1-click posting</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <YouTubePublishModal
        isOpen={isYouTubeModalOpen}
        clip={clip}
        sourceCopyright={sourceCopyright}
        title={youtubeTitle}
        description={youtubeDescription}
        privacyStatus={clipYoutubePrivacy}
        license={clipYoutubeLicense}
        connectedChannelId={socialAccounts?.youtube?.channelId ?? null}
        connectedChannelTitle={socialAccounts?.youtube?.channelTitle ?? null}
        canDirectPublish={Boolean(isPlatformConnected('youtube') && jobId)}
        isPublishing={publishingPlatform === 'youtube'}
        publishError={publishError}
        publishedResult={publishedResults.youtube ?? null}
        onTitleChange={setYoutubeTitle}
        onDescriptionChange={setYoutubeDescription}
        onPrivacyChange={setClipYoutubePrivacy}
        onLicenseChange={setClipYoutubeLicense}
        onClose={() => setIsYouTubeModalOpen(false)}
        onPublish={() =>
          void executePublish('youtube', {
            title: youtubeTitle,
            caption: youtubeDescription,
            privacyStatus: clipYoutubePrivacy,
            license: clipYoutubeLicense,
          })
        }
        onOpenAccounts={onOpenAccounts}
      />
    </article>
  );
}

