import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, createJob, getJobStatus } from './api';
import { EmptyPreview } from './components/EmptyPreview';
import { ErrorState } from './components/ErrorState';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HeroForm } from './components/HeroForm';
import { ProcessingStepper } from './components/ProcessingStepper';
import { ResultsGrid } from './components/ResultsGrid';
import type { ClipItem, ClipLength, JobStep } from './types';
import { validateYouTubeUrl } from './utils/youtube';

const POLL_INTERVAL_MS = 3000;
const SAMPLE_YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

type ViewState = 'idle' | 'processing' | 'results' | 'error';

export default function App() {
  const [url, setUrl] = useState('');
  const [clipLength, setClipLength] = useState<ClipLength>(30);
  const [clipCount, setClipCount] = useState<number>(3);
  const [captions, setCaptions] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [viewState, setViewState] = useState<ViewState>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [currentStep, setCurrentStep] = useState<JobStep>('Fetching video');
  const [progress, setProgress] = useState(0);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [jobError, setJobError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

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
  };

  const handleReset = () => {
    stopPolling();
    setActiveJobId(null);
    setViewState('idle');
    setProgress(0);
    setCurrentStep('Fetching video');
    setJobError(null);
    setClips([]);
    setValidationError(null);
  };

  const handleFillDemoUrl = () => {
    setUrl(SAMPLE_YOUTUBE_URL);
    setValidationError(null);
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

    setValidationError(null);
    setJobError(null);
    setIsSubmitting(true);

    try {
      const { jobId } = await createJob({
        url: validation.canonicalUrl,
        clipLength,
        clipCount,
        captions,
      });

      setSubmittedUrl(validation.canonicalUrl);
      setActiveJobId(jobId);
      setCurrentStep('Fetching video');
      setProgress(10);
      setClips([]);
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
        onReset={handleReset}
        onFillDemoUrl={handleFillDemoUrl}
      />

      <main className="flex-1 px-4 sm:px-6 lg:px-8">
        {viewState === 'idle' && (
          <>
            <HeroForm
              url={url}
              clipLength={clipLength}
              clipCount={clipCount}
              captions={captions}
              validationError={validationError}
              isSubmitting={isSubmitting}
              onUrlChange={handleUrlChange}
              onClipLengthChange={setClipLength}
              onClipCountChange={setClipCount}
              onCaptionsChange={setCaptions}
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
          <ResultsGrid clips={clips} sourceUrl={submittedUrl} onReset={handleReset} />
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
    </div>
  );
}
