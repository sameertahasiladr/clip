import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Hash,
  Link2,
  Loader2,
  Sparkles,
  Upload,
  X,
  Youtube,
} from 'lucide-react';
import type { ClipItem, PublishClipResponse, YouTubePrivacyStatus } from '../types';
import { copyTextToClipboard } from '../utils/download';
import { formatDuration } from '../utils/youtube';
import {
  YOUTUBE_DESCRIPTION_MAX_CHARS,
  YOUTUBE_TITLE_MAX_CHARS,
  appendHashtagSafely,
  appendViralHashtagsPack,
  hasHashtag,
  suggestViralHashtags,
} from '../utils/youtubeMetadata';

interface YouTubePublishModalProps {
  isOpen: boolean;
  clip: ClipItem;
  title: string;
  description: string;
  privacyStatus: YouTubePrivacyStatus;
  connectedChannelTitle: string | null;
  canDirectPublish: boolean;
  isPublishing: boolean;
  publishError: string | null;
  publishedResult: PublishClipResponse | null;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPrivacyChange: (value: YouTubePrivacyStatus) => void;
  onClose: () => void;
  onPublish: () => void;
  onOpenAccounts: () => void;
}

export function YouTubePublishModal({
  isOpen,
  clip,
  title,
  description,
  privacyStatus,
  connectedChannelTitle,
  canDirectPublish,
  isPublishing,
  publishError,
  publishedResult,
  onTitleChange,
  onDescriptionChange,
  onPrivacyChange,
  onClose,
  onPublish,
  onOpenAccounts,
}: YouTubePublishModalProps) {
  const [copiedField, setCopiedField] = useState<'title' | 'description' | null>(null);

  const hashtagSuggestions = useMemo(
    () =>
      suggestViralHashtags({
        title: `${clip.title} ${title}`,
        caption: `${clip.caption} ${description}`,
        transcriptCues: clip.captionCues,
      }),
    [clip.caption, clip.captionCues, clip.title, description, title]
  );

  const titleHashtagOptions = hashtagSuggestions.titleHashtags;
  const descriptionHashtagOptions = hashtagSuggestions.allDescriptionHashtags;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPublishing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isPublishing, onClose]);

  if (!isOpen) return null;

  const titleLen = title.length;
  const descriptionLen = description.length;
  const isTitleEmpty = title.trim().length === 0;
  const isTitleOverLimit = titleLen > YOUTUBE_TITLE_MAX_CHARS;
  const isDescriptionOverLimit = descriptionLen > YOUTUBE_DESCRIPTION_MAX_CHARS;
  const isFormInvalid = isTitleEmpty || isTitleOverLimit || isDescriptionOverLimit;

  const handleCopy = async (field: 'title' | 'description', value: string) => {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="youtube-publish-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#12121C] shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/15 text-rose-400">
              <Youtube className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="youtube-publish-modal-title"
                className="truncate text-lg font-bold text-white"
              >
                YouTube Shorts Details
              </h2>
              <p className="truncate text-xs text-zinc-400">
                {connectedChannelTitle
                  ? `Uploading to ${connectedChannelTitle}`
                  : 'Customize your 100-char title & 5000-char description with viral hashtags'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isPublishing}
            onClick={onClose}
            aria-label="Close YouTube details editor"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable body: 2-column YouTube Studio-style Details + Video Preview */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {publishedResult && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>
                  Published to <strong>{publishedResult.accountLabel}</strong>!
                </span>
              </div>
              <a
                href={publishedResult.publishedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 transition-colors"
              >
                <span>Open on YouTube</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          )}

          {publishError && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-sm text-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
              <span>{publishError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
            {/* Left column: Details form */}
            <div className="space-y-5">
              {/* Title (required) — 100 char limit + Suggested hashtags */}
              <div
                className={`rounded-xl border bg-[#0B0B13] p-4 transition-colors ${
                  isTitleEmpty || isTitleOverLimit
                    ? 'border-rose-500/60'
                    : 'border-white/[0.12] focus-within:border-fuchsia-400/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="yt-title-input"
                    className={`text-xs font-semibold ${
                      isTitleEmpty || isTitleOverLimit ? 'text-rose-300' : 'text-zinc-300'
                    }`}
                  >
                    Title (required)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopy('title', title)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors"
                    >
                      {copiedField === 'title' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                          <span className="text-emerald-300">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <span
                      data-testid="yt-title-counter"
                      className={`font-mono text-xs tabular-nums ${
                        isTitleEmpty || isTitleOverLimit ? 'text-rose-400 font-semibold' : 'text-zinc-400'
                      }`}
                    >
                      {titleLen}/{YOUTUBE_TITLE_MAX_CHARS}
                    </span>
                  </div>
                </div>

                <textarea
                  id="yt-title-input"
                  rows={2}
                  maxLength={YOUTUBE_TITLE_MAX_CHARS}
                  value={title}
                  disabled={isPublishing}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Add a title that describes your video (include #Shorts #Viral)"
                  className="mt-2 w-full resize-none bg-transparent text-sm leading-relaxed text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
                />

                {/* Suggested hashtags row matching YouTube Studio */}
                <div className="mt-3 border-t border-white/[0.07] pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-zinc-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden="true" />
                      <span>Suggested viral hashtags for title</span>
                    </span>
                    {hashtagSuggestions.detectedNiche && (
                      <span className="text-[10px] font-medium text-fuchsia-300/90">
                        Context: {hashtagSuggestions.detectedNiche}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {titleHashtagOptions.map((tag) => {
                      const active = hasHashtag(title, tag);
                      const wouldExceed =
                        !active &&
                        title.trimEnd().length + (title.trim() ? 1 : 0) + tag.length >
                          YOUTUBE_TITLE_MAX_CHARS;
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={isPublishing || active || wouldExceed}
                          onClick={() =>
                            onTitleChange(
                              appendHashtagSafely(title, tag, YOUTUBE_TITLE_MAX_CHARS, ' ')
                            )
                          }
                          title={
                            active
                              ? 'Already included in title'
                              : wouldExceed
                                ? 'Shorten title slightly to fit within 100 characters'
                                : `Add ${tag} to title`
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                              : wouldExceed
                                ? 'border-white/[0.06] bg-white/[0.02] text-zinc-600 cursor-not-allowed'
                                : 'border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:border-fuchsia-400/50 hover:bg-fuchsia-500/15 hover:text-white'
                          }`}
                        >
                          {active ? `✓ ${tag}` : `+ ${tag}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Description — 5000 char limit + Viral hashtags pack */}
              <div
                className={`rounded-xl border bg-[#0B0B13] p-4 transition-colors ${
                  isDescriptionOverLimit
                    ? 'border-rose-500/60'
                    : 'border-white/[0.12] focus-within:border-fuchsia-400/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="yt-description-input" className="text-xs font-semibold text-zinc-300">
                    Description
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopy('description', description)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors"
                    >
                      {copiedField === 'description' ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                          <span className="text-emerald-300">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <span
                      data-testid="yt-description-counter"
                      className={`font-mono text-xs tabular-nums ${
                        isDescriptionOverLimit ? 'text-rose-400 font-semibold' : 'text-zinc-400'
                      }`}
                    >
                      {descriptionLen}/{YOUTUBE_DESCRIPTION_MAX_CHARS}
                    </span>
                  </div>
                </div>

                <textarea
                  id="yt-description-input"
                  rows={7}
                  maxLength={YOUTUBE_DESCRIPTION_MAX_CHARS}
                  value={description}
                  disabled={isPublishing}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  placeholder="Tell viewers about your video and include viral hashtags..."
                  className="mt-2 w-full resize-y bg-transparent text-sm leading-relaxed text-white placeholder:text-zinc-500 focus:outline-none disabled:opacity-60"
                />

                {/* Viral hashtags helper bar */}
                <div className="mt-3 border-t border-white/[0.07] pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                      <Hash className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden="true" />
                      <span>
                        Trending &amp; viral hashtags
                        {hashtagSuggestions.detectedNiche
                          ? ` · ${hashtagSuggestions.detectedNiche}`
                          : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isPublishing}
                      onClick={() =>
                        onDescriptionChange(
                          appendViralHashtagsPack(description, descriptionHashtagOptions)
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-fuchsia-500/35 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      <span>Inject Viral Hashtags</span>
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {descriptionHashtagOptions.map((tag) => {
                      const active = hasHashtag(description, tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={isPublishing || active}
                          onClick={() =>
                            onDescriptionChange(
                              appendHashtagSafely(
                                description,
                                tag,
                                YOUTUBE_DESCRIPTION_MAX_CHARS,
                                '\n'
                              )
                            )
                          }
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                              : 'border-white/[0.1] bg-white/[0.04] text-zinc-300 hover:border-fuchsia-400/50 hover:bg-fuchsia-500/15 hover:text-white'
                          }`}
                        >
                          {active ? `✓ ${tag}` : `+ ${tag}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Visibility selector */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.09] bg-[#0B0B13] px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-200">Visibility</p>
                  <p className="text-[11px] text-zinc-500">
                    Choose who can watch this YouTube Short after upload
                  </p>
                </div>
                <div
                  role="group"
                  aria-label="YouTube Short visibility"
                  className="inline-flex rounded-lg border border-white/[0.08] bg-[#12121C] p-0.5"
                >
                  {(['public', 'unlisted', 'private'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      disabled={isPublishing}
                      aria-pressed={privacyStatus === level}
                      onClick={() => onPrivacyChange(level)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                        privacyStatus === level
                          ? 'bg-white/[0.16] text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column: Compact 9:16 video preview */}
            <aside className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#0B0B13]">
                <div className="relative aspect-[9/16] w-full bg-black">
                  {clip.videoUrl && clip.playbackMode !== 'youtube-embed' ? (
                    <video
                      src={clip.videoUrl}
                      poster={clip.posterUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : clip.posterUrl ? (
                    <img
                      src={clip.posterUrl}
                      alt={clip.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                      9:16 Vertical Short
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>9:16 Vertical Short</span>
                    <span className="font-mono tabular-nums">{formatDuration(clip.duration)}</span>
                  </div>
                  <p className="line-clamp-2 text-xs font-medium text-white">
                    {title.trim() || 'Untitled Short'}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] bg-[#0E0E17] px-6 py-4">
          <p className="text-xs text-zinc-400">
            {isTitleEmpty
              ? 'Enter a title (1–100 characters) before uploading.'
              : `Title: ${titleLen}/${YOUTUBE_TITLE_MAX_CHARS} · Description: ${descriptionLen}/${YOUTUBE_DESCRIPTION_MAX_CHARS}`}
          </p>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isPublishing}
              onClick={onClose}
              className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 text-xs font-semibold text-zinc-200 hover:bg-white/[0.09] transition-colors disabled:opacity-50"
            >
              {publishedResult ? 'Done' : 'Close'}
            </button>

            {canDirectPublish ? (
              <button
                type="button"
                disabled={isPublishing || isFormInvalid}
                onClick={onPublish}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 px-5 text-xs font-semibold text-white hover:brightness-110 transition-all disabled:opacity-50"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Uploading to YouTube...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    <span>{publishedResult ? 'Upload Again' : 'Upload to YouTube'}</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAccounts();
                }}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 text-xs font-semibold text-white hover:brightness-110 transition-all"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                <span>Connect YouTube to Upload</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
