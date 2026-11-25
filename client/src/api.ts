import type {
  ClipItem,
  CreateJobPayload,
  CreateJobResponse,
  JobResponse,
  JobStep,
  OAuthProvider,
  PublishClipPayload,
  PublishClipResponse,
  SocialAccountsState,
  SocialPlatform,
  VideoLayout,
} from './types';
import { validateYouTubeUrl } from './utils/youtube';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const API_BASE_URL = (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * Uses the real backend API (/api/jobs) by default.
 * Only activates standalone mock mode when VITE_USE_MOCK="true" is explicitly configured.
 */
export function isMockMode(): boolean {
  return env.VITE_USE_MOCK === 'true';
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface MockJobRecord {
  id: string;
  payload: CreateJobPayload;
  videoId: string;
  pollCount: number;
  shouldFail: boolean;
}

const mockJobs = new Map<string, MockJobRecord>();

const SAMPLE_CLIPS_CATALOG: Array<
  Omit<ClipItem, 'id' | 'duration' | 'captionsEnabled'>
> = [
  {
    title: 'Why 90% of Viral Hooks Win in the First Two Seconds',
    videoUrl: '/samples/clip-1.mp4',
    posterUrl: '/assets/images/clip_podcast_hook_1795412206873.jpg',
    score: 96,
    caption:
      'Stop opening your videos with "Hey guys." Start right in the middle of the tension and watch retention double. #shorts #creatorstrategy #contenttips',
    startTime: 142,
    endTime: 172,
    captionCues: [
      { start: 0, end: 2, text: 'STOP OPENING WITH "HEY GUYS."' },
      { start: 2, end: 4, text: 'START INSIDE THE TENSION FIRST' },
      { start: 4, end: 6.5, text: 'AND RETENTION DOUBLES OVERNIGHT.' },
    ],
  },
  {
    title: 'The One Pricing Mistake That Costs Founders Half Their Margin',
    videoUrl: '/samples/clip-2.mp4',
    posterUrl: '/assets/images/clip_keynote_insight_1795412207639.jpg',
    score: 92,
    caption:
      'Underpricing does not make you safer—it attracts the highest-churn customers. Price for the outcome, not the hours. #startups #founderadvice #reels',
    startTime: 418,
    endTime: 448,
    captionCues: [
      { start: 0, end: 2, text: 'UNDERPRICING NEVER MAKES YOU SAFER.' },
      { start: 2, end: 4, text: 'IT ATTRACTS HIGH-CHURN BUYERS.' },
      { start: 4, end: 6.5, text: 'PRICE FOR THE OUTCOME, NOT HOURS.' },
    ],
  },
  {
    title: 'Three-Point Desk Lighting Setup Under $150',
    videoUrl: '/samples/clip-3.mp4',
    posterUrl: '/assets/images/clip_creator_desk_1795412224882.jpg',
    score: 88,
    caption:
      'You do not need a $4,000 camera—move your key light 45 degrees off-axis and add one warm practical lamp behind you. #filmmaking #videotips #youtubeshorts',
    startTime: 705,
    endTime: 735,
    captionCues: [
      { start: 0, end: 2, text: 'SKIP THE $4,000 CAMERA UPGRADE.' },
      { start: 2, end: 4, text: 'ANGLE YOUR KEY LIGHT 45 DEGREES' },
      { start: 4, end: 6.5, text: 'AND ADD ONE WARM BACK LAMP.' },
    ],
  },
  {
    title: 'How Small Teams Ship Faster Than 50-Person Org Charts',
    videoUrl: '/samples/clip-4.mp4',
    posterUrl: '/assets/images/clip_whiteboard_strategy_1795412208855.jpg',
    score: 85,
    caption:
      'Every handoff adds a week of delay. Put engineering, design, and customer calls in the same room. #product #engineering #leadership',
    startTime: 1020,
    endTime: 1050,
    captionCues: [
      { start: 0, end: 2, text: 'EVERY HANDOFF ADDS A WEEK.' },
      { start: 2, end: 4, text: 'KEEP BUILDERS CLOSE TO USERS' },
      { start: 4, end: 6.5, text: 'AND CUT REVIEW CYCLES IN HALF.' },
    ],
  },
  {
    title: 'We Asked Creators Their Real Monthly RPM Numbers',
    videoUrl: '/samples/clip-5.mp4',
    posterUrl: '/assets/images/clip_street_interview_1795412215430.jpg',
    score: 83,
    caption:
      'Shorts views are only half the story—here is how creators turn vertical reach into newsletter and sponsor revenue. #creatoreconomy #shorts #growth',
    startTime: 1345,
    endTime: 1375,
    captionCues: [
      { start: 0, end: 2, text: 'VIEWS ARE ONLY HALF THE STORY.' },
      { start: 2, end: 4, text: 'VERTICAL CLIPS BUILD DISCOVERY,' },
      { start: 4, end: 6.5, text: 'LONG-FORM CONVERTS LOYAL FANS.' },
    ],
  },
];

const MOCK_STAGE_SEQUENCE: ReadonlyArray<{ step: JobStep; progress: number }> = [
  { step: 'Fetching video', progress: 18 },
  { step: 'Transcribing', progress: 44 },
  { step: 'Finding best moments', progress: 70 },
  { step: 'Cutting and formatting', progress: 90 },
  { step: 'Done', progress: 100 },
];

export function buildMockClips(
  jobId: string,
  clipLength: 15 | 30,
  clipCount: number,
  captions: boolean
): ClipItem[] {
  const safeCount = Math.min(Math.max(clipCount, 1), 20);
  return Array.from({ length: safeCount }, (_, index) => {
    const template = SAMPLE_CLIPS_CATALOG[index % SAMPLE_CLIPS_CATALOG.length];
    const offset = index === 0 ? 0 : index % 2 === 0 ? -1 : 1;
    const duration = Math.max(13, Math.min(32, clipLength + offset));
    return {
      ...template,
      id: `${jobId}-clip-${index + 1}`,
      duration,
      captionsEnabled: captions,
    };
  });
}

function generateLocalJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createMockJob(payload: CreateJobPayload): Promise<CreateJobResponse> {
  const validation = validateYouTubeUrl(payload.url);
  if (!validation.valid || !validation.videoId) {
    throw new ApiError(validation.error ?? 'Invalid YouTube URL.', 400, 'INVALID_URL');
  }

  const jobId = generateLocalJobId();
  mockJobs.set(jobId, {
    id: jobId,
    payload,
    videoId: validation.videoId,
    pollCount: 0,
    shouldFail: validation.videoId.toLowerCase() === 'errordemo00',
  });

  await new Promise((resolve) => setTimeout(resolve, 250));
  return { jobId };
}

async function getMockJobStatus(jobId: string): Promise<JobResponse> {
  const record = mockJobs.get(jobId);
  if (!record) {
    throw new ApiError('Job not found. Start a new clip generation request.', 404, 'JOB_NOT_FOUND');
  }

  await new Promise((resolve) => setTimeout(resolve, 180));

  const stageIndex = Math.min(record.pollCount, MOCK_STAGE_SEQUENCE.length - 1);
  record.pollCount += 1;

  if (record.shouldFail && stageIndex >= 1) {
    return {
      status: 'failed',
      step: 'Transcribing',
      progress: 35,
      clips: [],
      error: 'Video exceeds the 60-minute limit or does not provide an accessible audio track.',
    };
  }

  const stage = MOCK_STAGE_SEQUENCE[stageIndex];
  if (stage.step === 'Done') {
    return {
      status: 'done',
      step: 'Done',
      progress: 100,
      clips: buildMockClips(
        record.id,
        record.payload.clipLength,
        record.payload.clipCount,
        record.payload.captions
      ),
    };
  }

  return {
    status: stageIndex === 0 ? 'queued' : 'processing',
    step: stage.step,
    progress: stage.progress,
    clips: [],
  };
}

export async function createJob(payload: CreateJobPayload): Promise<CreateJobResponse> {
  if (isMockMode()) {
    return createMockJob(payload);
  }

  const response = await fetch(`${API_BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as {
    jobId?: string;
    error?: string;
    code?: string;
  };

  if (!response.ok || !data.jobId) {
    throw new ApiError(
      data.error ?? `Unable to start clip generation (HTTP ${response.status}).`,
      response.status,
      data.code
    );
  }

  return { jobId: data.jobId };
}

export interface CreateUploadJobPayload {
  file: File;
  clipLength: 15 | 30;
  clipCount: number;
  captions: boolean;
  videoLayout?: VideoLayout;
}

export async function createUploadJob(payload: CreateUploadJobPayload): Promise<CreateJobResponse> {
  const videoLayout = payload.videoLayout ?? 'vertical-fill';
  if (isMockMode()) {
    const jobId = generateLocalJobId();
    mockJobs.set(jobId, {
      id: jobId,
      payload: {
        url: `Uploaded: ${payload.file.name}`,
        clipLength: payload.clipLength,
        clipCount: payload.clipCount,
        captions: payload.captions,
        videoLayout,
      },
      videoId: 'uploaddemo0',
      pollCount: 0,
      shouldFail: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { jobId };
  }

  const params = new URLSearchParams({
    clipLength: String(payload.clipLength),
    clipCount: String(payload.clipCount),
    captions: String(payload.captions),
    videoLayout,
    filename: payload.file.name,
  });

  const contentType =
    payload.file.type && payload.file.type.startsWith('video/')
      ? payload.file.type
      : 'application/octet-stream';

  const response = await fetch(`${API_BASE_URL}/api/jobs/upload?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body: payload.file,
  });

  const data = (await response.json().catch(() => ({}))) as {
    jobId?: string;
    error?: string;
    code?: string;
  };

  if (!response.ok || !data.jobId) {
    throw new ApiError(
      data.error ?? `Unable to upload video for clipping (HTTP ${response.status}).`,
      response.status,
      data.code
    );
  }

  return { jobId: data.jobId };
}

export async function getJobStatus(jobId: string): Promise<JobResponse> {
  if (isMockMode()) {
    return getMockJobStatus(jobId);
  }

  const response = await fetch(`${API_BASE_URL}/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  const data = (await response.json().catch(() => ({}))) as Partial<JobResponse> & {
    code?: string;
  };

  if (!response.ok || !data.status) {
    throw new ApiError(
      data.error ?? `Failed to check job status (HTTP ${response.status}).`,
      response.status,
      data.code
    );
  }

  return {
    status: data.status,
    step: data.step ?? 'Fetching video',
    progress: typeof data.progress === 'number' ? data.progress : 0,
    clips: Array.isArray(data.clips) ? data.clips : [],
    error: data.error,
  };
}

// In-memory opaque social session token (never persisted to localStorage or sessionStorage)
let socialSessionToken: string | null = null;

async function ensureSocialSessionToken(): Promise<string> {
  if (socialSessionToken) return socialSessionToken;

  const response = await fetch(`${API_BASE_URL}/api/social/session`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  const data = (await response.json().catch(() => ({}))) as {
    sessionToken?: string;
    error?: string;
  };

  if (!response.ok || !data.sessionToken) {
    throw new ApiError(
      data.error ?? `Unable to initialize social session (HTTP ${response.status}).`,
      response.status
    );
  }

  socialSessionToken = data.sessionToken;
  return socialSessionToken;
}

export async function fetchSocialAccounts(): Promise<SocialAccountsState> {
  const token = await ensureSocialSessionToken();
  const response = await fetch(`${API_BASE_URL}/api/social/accounts`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as SocialAccountsState & {
    error?: string;
  };

  if (!response.ok) {
    throw new ApiError(
      data.error ?? `Unable to load connected accounts (HTTP ${response.status}).`,
      response.status
    );
  }

  return data;
}

export async function getSocialOAuthUrl(
  provider: OAuthProvider
): Promise<{ url: string; redirectUri: string }> {
  const token = await ensureSocialSessionToken();
  const response = await fetch(`${API_BASE_URL}/api/social/oauth/${provider}/url`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const data = (await response.json().catch(() => ({}))) as {
    url?: string;
    redirectUri?: string;
    error?: string;
    code?: string;
  };

  if (!response.ok || !data.url) {
    throw new ApiError(
      data.error ?? `Unable to start ${provider} OAuth connection (HTTP ${response.status}).`,
      response.status,
      data.code
    );
  }

  return { url: data.url, redirectUri: data.redirectUri ?? '' };
}

export async function selectMetaPage(pageId: string): Promise<SocialAccountsState> {
  const token = await ensureSocialSessionToken();
  const response = await fetch(`${API_BASE_URL}/api/social/meta/select-page`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ pageId }),
  });

  const data = (await response.json().catch(() => ({}))) as SocialAccountsState & {
    error?: string;
  };

  if (!response.ok) {
    throw new ApiError(
      data.error ?? `Could not switch Facebook Page (HTTP ${response.status}).`,
      response.status
    );
  }

  return data;
}

export async function disconnectSocialAccount(platform: SocialPlatform): Promise<void> {
  const token = await ensureSocialSessionToken();
  const response = await fetch(`${API_BASE_URL}/api/social/accounts/${platform}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      data.error ?? `Could not disconnect ${platform} (HTTP ${response.status}).`,
      response.status
    );
  }
}

export async function publishClipToSocial(
  payload: PublishClipPayload
): Promise<PublishClipResponse> {
  const token = await ensureSocialSessionToken();
  const response = await fetch(`${API_BASE_URL}/api/social/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as Partial<PublishClipResponse> & {
    error?: string;
    code?: string;
  };

  if (!response.ok || !data.publishedUrl || !data.externalId) {
    throw new ApiError(
      data.error ?? `Could not publish clip to ${payload.platform} (HTTP ${response.status}).`,
      response.status,
      data.code
    );
  }

  return {
    ok: true,
    platform: payload.platform,
    externalId: data.externalId,
    publishedUrl: data.publishedUrl,
    accountLabel: data.accountLabel ?? payload.platform,
  };
}

