import { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Facebook,
  Instagram,
  Link2,
  Loader2,
  Unlink,
  X,
  Youtube,
} from 'lucide-react';
import type {
  OAuthProvider,
  SocialAccountsState,
  SocialPlatform,
  YouTubePrivacyStatus,
} from '../types';
import { copyTextToClipboard } from '../utils/download';

interface SocialAccountsModalProps {
  isOpen: boolean;
  accounts: SocialAccountsState | null;
  isLoading: boolean;
  connectingProvider: OAuthProvider | null;
  oauthError: string | null;
  youtubePrivacy: YouTubePrivacyStatus;
  onClose: () => void;
  onConnect: (provider: OAuthProvider) => void;
  onDisconnect: (platform: SocialPlatform) => void;
  onSelectMetaPage: (pageId: string) => void;
  onYouTubePrivacyChange: (privacy: YouTubePrivacyStatus) => void;
}

export function SocialAccountsModal({
  isOpen,
  accounts,
  isLoading,
  connectingProvider,
  oauthError,
  youtubePrivacy,
  onClose,
  onConnect,
  onDisconnect,
  onSelectMetaPage,
  onYouTubePrivacyChange,
}: SocialAccountsModalProps) {
  const [copiedUri, setCopiedUri] = useState<'youtube' | 'meta' | null>(null);

  if (!isOpen) return null;

  const ytConfigured = accounts?.configured.youtube ?? false;
  const metaConfigured = accounts?.configured.meta ?? false;
  const ytAccount = accounts?.youtube ?? null;
  const fbAccount = accounts?.facebook ?? null;
  const igAccount = accounts?.instagram ?? null;
  const metaPages = accounts?.metaPages ?? [];

  const handleCopyUri = async (key: 'youtube' | 'meta', uri: string) => {
    const ok = await copyTextToClipboard(uri);
    if (ok) {
      setCopiedUri(key);
      setTimeout(() => setCopiedUri(null), 2000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="social-accounts-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/[0.12] bg-[#12121C] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div>
            <h2 id="social-accounts-title" className="text-xl font-bold text-white">
              Connect Social Accounts
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Link your YouTube channel, Facebook Page, and Instagram Business/Creator account for
              1-click direct posting.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connected accounts dialog"
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.08] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {oauthError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-sm text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{oauthError}</span>
          </div>
        )}

        {isLoading && !accounts ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-fuchsia-400" aria-hidden="true" />
            <span>Loading connected accounts...</span>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* 1. YouTube Channel Card */}
            <div className="rounded-xl border border-white/[0.09] bg-[#0B0B13] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/25">
                    <Youtube className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">YouTube Shorts</h3>
                      {ytAccount && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-zinc-400">
                      {ytAccount
                        ? ytAccount.channelTitle
                        : 'Upload 9:16 clips directly to your YouTube channel'}
                    </p>
                  </div>
                </div>

                {ytAccount ? (
                  <button
                    type="button"
                    onClick={() => onDisconnect('youtube')}
                    className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/[0.09] transition-colors shrink-0"
                  >
                    <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Disconnect</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={connectingProvider !== null}
                    onClick={() => onConnect('youtube')}
                    className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 text-xs font-semibold text-white hover:brightness-110 transition-all shrink-0 disabled:opacity-50"
                  >
                    {connectingProvider === 'youtube' ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Connect YouTube</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* YouTube privacy setting when connected */}
              {ytAccount && (
                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
                  <span className="text-xs text-zinc-400">Default Shorts visibility</span>
                  <div
                    role="group"
                    aria-label="YouTube Shorts visibility"
                    className="inline-flex rounded-lg border border-white/[0.08] bg-[#12121C] p-0.5"
                  >
                    {(['public', 'unlisted', 'private'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={youtubePrivacy === level}
                        onClick={() => onYouTubePrivacyChange(level)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                          youtubePrivacy === level
                            ? 'bg-white/[0.14] text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!ytConfigured && accounts?.redirectUris.youtube && (
                <div className="mt-3.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-100/90">
                  <p className="font-semibold text-amber-200">Server setup needed for YouTube</p>
                  <p className="mt-1 text-zinc-300">
                    Set <code className="font-mono text-amber-200">GOOGLE_CLIENT_ID</code> and{' '}
                    <code className="font-mono text-amber-200">GOOGLE_CLIENT_SECRET</code> in your{' '}
                    <code className="font-mono">.env</code> and add this Authorized Redirect URI in
                    Google Cloud Console:
                  </p>
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200">
                    <span className="truncate flex-1">{accounts.redirectUris.youtube}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyUri('youtube', accounts.redirectUris.youtube)}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-fuchsia-300 hover:bg-white/10 shrink-0"
                    >
                      {copiedUri === 'youtube' ? (
                        <>
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Facebook Page & Instagram Reels Card (Meta Graph API OAuth) */}
            <div className="rounded-xl border border-white/[0.09] bg-[#0B0B13] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex -space-x-2 shrink-0">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/25">
                      <Facebook className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-500/15 text-pink-400 border border-pink-500/25">
                      <Instagram className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">
                        Facebook Page &amp; Instagram Reels
                      </h3>
                      {(fbAccount || igAccount) && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Connected
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-zinc-400">
                      {fbAccount || igAccount
                        ? [
                            fbAccount ? `Page: ${fbAccount.pageName}` : null,
                            igAccount ? `IG: @${igAccount.username}` : 'No linked IG Business account',
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'One Meta login connects both your Facebook Page and linked Instagram Business/Creator account'}
                    </p>
                  </div>
                </div>

                {fbAccount || igAccount ? (
                  <div className="flex items-center gap-2 shrink-0">
                    {fbAccount && (
                      <button
                        type="button"
                        onClick={() => onDisconnect('facebook')}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/12 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/[0.09] transition-colors"
                      >
                        <Unlink className="h-3 w-3" aria-hidden="true" />
                        <span>Disconnect FB</span>
                      </button>
                    )}
                    {igAccount && (
                      <button
                        type="button"
                        onClick={() => onDisconnect('instagram')}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-white/12 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-200 hover:bg-white/[0.09] transition-colors"
                      >
                        <Unlink className="h-3 w-3" aria-hidden="true" />
                        <span>Disconnect IG</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={connectingProvider !== null}
                    onClick={() => onConnect('meta')}
                    className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 text-xs font-semibold text-white hover:brightness-110 transition-all shrink-0 disabled:opacity-50"
                  >
                    {connectingProvider === 'meta' ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Connect Facebook &amp; IG</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Page selector if multiple Facebook Pages are managed */}
              {metaPages.length > 0 && (
                <div className="mt-3.5 flex flex-col gap-2 border-t border-white/[0.07] pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <label htmlFor="meta-page-select" className="text-xs text-zinc-400">
                    Active Facebook Page
                  </label>
                  <select
                    id="meta-page-select"
                    value={accounts?.selectedMetaPageId ?? ''}
                    onChange={(e) => onSelectMetaPage(e.target.value)}
                    className="rounded-lg border border-white/[0.12] bg-[#12121C] px-3 py-1.5 text-xs font-medium text-white focus:border-fuchsia-400 focus:outline-none"
                  >
                    {metaPages.map((p) => (
                      <option key={p.pageId} value={p.pageId}>
                        {p.pageName}
                        {p.hasInstagram && p.instagramUsername ? ` (IG: @${p.instagramUsername})` : ' (Facebook only)'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!metaConfigured && accounts?.redirectUris.meta && (
                <div className="mt-3.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-100/90">
                  <p className="font-semibold text-amber-200">
                    Server setup needed for Facebook &amp; Instagram
                  </p>
                  <p className="mt-1 text-zinc-300">
                    Set <code className="font-mono text-amber-200">META_APP_ID</code> and{' '}
                    <code className="font-mono text-amber-200">META_APP_SECRET</code> in your{' '}
                    <code className="font-mono">.env</code> and add this Valid OAuth Redirect URI in
                    Meta for Developers:
                  </p>
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200">
                    <span className="truncate flex-1">{accounts.redirectUris.meta}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyUri('meta', accounts.redirectUris.meta)}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-fuchsia-300 hover:bg-white/10 shrink-0"
                    >
                      {copiedUri === 'meta' ? (
                        <>
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-xs text-zinc-400">
              <span>
                Note: Instagram Reels API requires an Instagram Business or Creator account linked
                to your Facebook Page and a public HTTPS clip URL (via Cloudinary or HTTPS{' '}
                <code className="font-mono text-zinc-300">APP_URL</code>).
              </span>
              <a
                href="https://developers.facebook.com/apps/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-fuchsia-300 hover:text-fuchsia-200 shrink-0"
              >
                <span>Meta Portal</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
