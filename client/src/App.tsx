import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  checkYouTubeCopyright,
  createJob,
  disconnectSocialAccount,
  fetchSocialAccounts,
  getJobStatus,
  getSocialOAuthUrl,
  selectMetaPage,
  uploadCustomAudioTrack,
} from './api';
import { EmptyPreview } from './components/EmptyPreview';
import { ErrorState } from './components/ErrorState';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HeroForm } from './components/HeroForm';
import { ProcessingStepper } from './components/ProcessingStepper';
import { ResultsGrid } from './components/ResultsGrid';
import { SocialAccountsModal } from './components/SocialAccountsModal';
import type {
  AudioMode,
  ClipItem,
  ClipLength,
  JobStep,
  OAuthProvider,
  SocialAccountsState,
  SocialPlatform,
  SourceCopyrightInfo,
  UploadedAudioTrackResponse,
  VideoLayout,
  YouTubePrivacyStatus,
} from './types';
import { validateYouTubeUrl } from './utils/youtube';

const POLL_INTERVAL_MS = 3000;
const SAMPLE_YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

type ViewState = 'idle' | 'processing' | 'results' | 'error';

function isTrustedOAuthMessageOrigin(origin: string, expectedCallbackOrigin?: string | null): boolean {
  if (!origin) return false;
  if (origin === window.location.origin) return true;
  if (expectedCallbackOrigin && origin === expectedCallbackOrigin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export default function App() {
  const [url, setUrl] = useState('');
  const [clipLength, setClipLength] = useState<ClipLength>(30);
  const [clipCount, setClipCount] = useState<number>(3);
  const [captions, setCaptions] = useState<boolean>(true);
  const [videoLayout, setVideoLayout] = useState<VideoLayout>('vertical-fill');
  const [audioMode, setAudioMode] = useState<AudioMode>('original');
  const [customAudioTrack, setCustomAudioTrack] = useState<UploadedAudioTrackResponse | null>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState<string | null>(null);
  const [preCheckCopyright, setPreCheckCopyright] = useState<SourceCopyrightInfo | null>(null);
  const [isCheckingCopyright, setIsCheckingCopyright] = useState(false);
  const [preCheckError, setPreCheckError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [viewState, setViewState] = useState<ViewState>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [currentStep, setCurrentStep] = useState<JobStep>('Fetching video');
  const [progress, setProgress] = useState(0);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [sourceDuration, setSourceDuration] = useState<number | undefined>(undefined);
  const [sourceCopyright, setSourceCopyright] = useState<SourceCopyrightInfo | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  // Connected Social Accounts state (tokens stay strictly server-side)
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountsState | null>(null);
  const [isAccountsModalOpen, setIsAccountsModalOpen] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<OAuthProvider | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [youtubePrivacy, setYoutubePrivacy] = useState<YouTubePrivacyStatus>('public');

  const pollTimerRef = useRef<number | null>(null);

  const loadSocialAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);
    try {
      const state = await fetchSocialAccounts();
      setSocialAccounts(state);
    } catch {
      // Non-fatal in standalone mock mode
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    void loadSocialAccounts();
  }, [loadSocialAccounts]);

  // Listen for OAuth popup completion postMessage from /api/social/oauth/:provider/callback
  useEffect(() => {
    let expectedCallbackOrigin: string | null = null;
    try {
      const sampleUri = socialAccounts?.redirectUris.youtube || socialAccounts?.redirectUris.meta;
      if (sampleUri) expectedCallbackOrigin = new URL(sampleUri).origin;
    } catch {
      expectedCallbackOrigin = null;
    }

    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedOAuthMessageOrigin(event.origin, expectedCallbackOrigin)) return;
      const data = event.data as { type?: string; error?: string } | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'CLIPGENIE_OAUTH_SUCCESS') {
        setConnectingProvider(null);
        setOauthError(null);
        void loadSocialAccounts();
      } else if (data.type === 'CLIPGENIE_OAUTH_ERROR') {
        setConnectingProvider(null);
        setOauthError(data.error || 'OAuth authorization was cancelled or failed.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadSocialAccounts, socialAccounts?.redirectUris.meta, socialAccounts?.redirectUris.youtube]);

  const handleConnectProvider = async (provider: OAuthProvider) => {
    setOauthError(null);
    setConnectingProvider(provider);
    try {
      const { url: providerAuthUrl } = await getSocialOAuthUrl(provider);
      const popup = window.open(
        providerAuthUrl,
        `clipgenie_oauth_${provider}`,
        'width=600,height=720,noopener=no'
      );
      if (!popup) {
        setConnectingProvider(null);
        setOauthError(
          'Your browser blocked the sign-in popup. Allow popups for this site and click Connect again.'
        );
        return;
      }

      // Reset spinner cleanly if the user closes the popup manually
      const watchClosed = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(watchClosed);
          setConnectingProvider((current) => (current === provider ? null : current));
          void loadSocialAccounts();
        }
      }, 600);
    } catch (err) {
      setConnectingProvider(null);
      setOauthError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Unable to start account connection.'
      );
    }
  };

  const handleDisconnectPlatform = async (platform: SocialPlatform) => {
    setOauthError(null);
    try {
      await disconnectSocialAccount(platform);
      await loadSocialAccounts();
    } catch (err) {
      setOauthError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not disconnect account.'
      );
    }
  };

  const handleSelectMetaPage = async (pageId: string) => {
    setOauthError(null);
    try {
      const updated = await selectMetaPage(pageId);
      setSocialAccounts(updated);
    } catch (err) {
      setOauthError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not switch active Facebook Page.'
      );
    }
  };

  const connectedCount =
    (socialAccounts?.youtube ? 1 : 0) +
    (socialAccounts?.facebook ? 1 : 0) +
    (socialAccounts?.instagram ? 1 : 0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const result = await getJobStatus(jobId);
        setCurrentStep(result.step);
        setProgress(result.progress);
        if (result.sourceCopyright) {
          setSourceCopyright(result.sourceCopyright);
        }
        if (typeof result.sourceDuration === 'number' && result.sourceDuration > 0) {
          setSourceDuration(result.sourceDuration);
        }

        if (result.status === 'done') {
          stopPolling();
          setClips(result.clips);
          setViewState('results');
        } else if (result.status === 'failed') {
          stopPolling();
          setJobError(
            result.error ?? 'Something went wrong while processing this video. Please try again.'
          );
          setViewState('error');
        }
      } catch (err) {
        stopPolling();
        const message =
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Lost connection to ClipGenie while checking job status.';
        setJobError(message);
        setViewState('error');
      }
    },
    [stopPolling]
  );

  useEffect(() => {
    if (viewState !== 'processing' || !activeJobId) {
      stopPolling();
      return;
    }

    void pollJob(activeJobId);
    pollTimerRef.current = window.setInterval(() => {
      void pollJob(activeJobId);
    }, POLL_INTERVAL_MS);

    return () => {
      stopPolling();
    };
  }, [activeJobId, viewState, pollJob, stopPolling]);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (validationError) {
      setValidationError(null);
    }
    if (preCheckCopyright) {
      setPreCheckCopyright(null);
    }
    if (preCheckError) {
      setPreCheckError(null);
    }
  };

  const handleCheckCopyright = async () => {
    const validation = validateYouTubeUrl(url);
    if (!validation.valid || !validation.canonicalUrl) {
      setValidationError(validation.error ?? 'Please enter a valid YouTube link.');
      return;
    }

    setValidationError(null);
    setPreCheckError(null);
    setIsCheckingCopyright(true);
    try {
      const info = await checkYouTubeCopyright(validation.canonicalUrl);
      setPreCheckCopyright(info);
    } catch (err) {
      setPreCheckCopyright(null);
      setPreCheckError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Unable to check copyright details for this YouTube video.'
      );
    } finally {
      setIsCheckingCopyright(false);
    }
  };

  const handleUploadCustomAudio = async (file: File) => {
    setAudioUploadError(null);
    setIsUploadingAudio(true);
    try {
      const uploaded = await uploadCustomAudioTrack(file);
      setCustomAudioTrack(uploaded);
      setAudioMode('custom-audio');
    } catch (err) {
      setAudioUploadError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Could not upload audio file. Please use MP3, WAV, M4A, OGG, or FLAC under 25 MB.'
      );
    } finally {
      setIsUploadingAudio(false);
    }
  };

  const handleReset = () => {
    stopPolling();
    setActiveJobId(null);
    setViewState('idle');
    setProgress(0);
    setCurrentStep('Fetching video');
    setJobError(null);
    setClips([]);
    setSourceDuration(undefined);
    setSourceCopyright(null);
    setPreCheckCopyright(null);
    setPreCheckError(null);
    setValidationError(null);
  };

  const handleClipUpdated = (
    clipIndex: number,
    updatedClip: ClipItem,
    nextSourceDuration?: number
  ) => {
    setClips((prev) =>
      prev.map((item, idx) => (idx === clipIndex ? updatedClip : item))
    );
    if (typeof nextSourceDuration === 'number' && nextSourceDuration > 0) {
      setSourceDuration(nextSourceDuration);
    }
  };

  const handleFillDemoUrl = () => {
    setUrl(SAMPLE_YOUTUBE_URL);
    setValidationError(null);
    setPreCheckCopyright(null);
    setPreCheckError(null);
    const input = document.getElementById('youtube-url-input');
    input?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateYouTubeUrl(url);
    if (!validation.valid || !validation.canonicalUrl) {
      setValidationError(validation.error ?? 'Please enter a valid YouTube link.');
      return;
    }

    if (audioMode === 'custom-audio' && !customAudioTrack) {
      setAudioUploadError('Upload a royalty-free audio file first, or switch back to Original/Mute audio.');
      return;
    }

    setValidationError(null);
    setAudioUploadError(null);
    setJobError(null);
    setIsSubmitting(true);

    try {
      const safeClipCount = Math.min(20, Math.max(1, Math.round(clipCount)));
      const { jobId } = await createJob({
        url: validation.canonicalUrl,
        clipLength,
        clipCount: safeClipCount,
        captions,
        videoLayout,
        audioMode,
        customAudioTrackId:
          audioMode === 'custom-audio' ? customAudioTrack?.audioTrackId : undefined,
      });

      setSubmittedUrl(validation.canonicalUrl);
      setActiveJobId(jobId);
      setCurrentStep('Fetching video');
      setProgress(10);
      setClips([]);
      setSourceDuration(undefined);
      setSourceCopyright(null);
      setViewState('processing');
    } catch (err) {
      const message =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Unable to start clip generation. Please try again.';
      setJobError(message);
      setViewState('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#09090F] text-zinc-100">
      <Header
        hasActiveSession={viewState !== 'idle'}
        connectedCount={connectedCount}
        onReset={handleReset}
        onFillDemoUrl={handleFillDemoUrl}
        onOpenAccounts={() => {
          setOauthError(null);
          setIsAccountsModalOpen(true);
          void loadSocialAccounts();
        }}
      />

      <main className="flex-1 px-4 sm:px-6 lg:px-8">
        {viewState === 'idle' && (
          <>
            <HeroForm
              url={url}
              clipLength={clipLength}
              clipCount={clipCount}
              captions={captions}
              videoLayout={videoLayout}
              audioMode={audioMode}
              customAudioTrack={customAudioTrack}
              isUploadingAudio={isUploadingAudio}
              audioUploadError={audioUploadError}
              preCheckCopyright={preCheckCopyright}
              isCheckingCopyright={isCheckingCopyright}
              preCheckError={preCheckError}
              connectedChannelId={socialAccounts?.youtube?.channelId ?? null}
              validationError={validationError}
              isSubmitting={isSubmitting}
              onUrlChange={handleUrlChange}
              onClipLengthChange={setClipLength}
              onClipCountChange={setClipCount}
              onCaptionsChange={setCaptions}
              onVideoLayoutChange={setVideoLayout}
              onAudioModeChange={(mode) => {
                setAudioMode(mode);
                setAudioUploadError(null);
              }}
              onUploadCustomAudio={(file) => void handleUploadCustomAudio(file)}
              onClearCustomAudio={() => {
                setCustomAudioTrack(null);
                setAudioUploadError(null);
              }}
              onCheckCopyright={() => void handleCheckCopyright()}
              onSubmit={handleSubmit}
            />
            <EmptyPreview />
          </>
        )}

        {viewState === 'processing' && (
          <ProcessingStepper
            currentStep={currentStep}
            progress={progress}
            sourceUrl={submittedUrl}
            onCancel={handleReset}
          />
        )}

        {viewState === 'results' && (
          <ResultsGrid
            clips={clips}
            jobId={activeJobId}
            sourceUrl={submittedUrl}
            sourceDuration={sourceDuration}
            sourceCopyright={sourceCopyright}
            socialAccounts={socialAccounts}
            youtubePrivacy={youtubePrivacy}
            onReset={handleReset}
            onOpenAccounts={() => {
              setOauthError(null);
              setIsAccountsModalOpen(true);
              void loadSocialAccounts();
            }}
            onClipUpdated={handleClipUpdated}
          />
        )}

        {viewState === 'error' && (
          <ErrorState
            message={jobError ?? 'An unexpected error occurred while creating your clips.'}
            onRetry={handleReset}
            onTrySample={() => {
              handleReset();
              setUrl(SAMPLE_YOUTUBE_URL);
            }}
          />
        )}
      </main>

      <Footer />

      <SocialAccountsModal
        isOpen={isAccountsModalOpen}
        accounts={socialAccounts}
        isLoading={isLoadingAccounts}
        connectingProvider={connectingProvider}
        oauthError={oauthError}
        youtubePrivacy={youtubePrivacy}
        onClose={() => setIsAccountsModalOpen(false)}
        onConnect={(provider) => void handleConnectProvider(provider)}
        onDisconnect={(platform) => void handleDisconnectPlatform(platform)}
        onSelectMetaPage={(pageId) => void handleSelectMetaPage(pageId)}
        onYouTubePrivacyChange={setYoutubePrivacy}
      />
    </div>
  );
}
