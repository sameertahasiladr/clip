export type ClipLength = 15 | 30;

export type VideoLayout = 'vertical-fill' | 'vertical-blur';

export type AudioMode = 'original' | 'mute' | 'custom-audio';

export type YouTubeLicenseType = 'youtube' | 'creativeCommon';

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type JobStep =
  | 'Fetching video'
  | 'Transcribing'
  | 'Finding best moments'
  | 'Cutting and formatting'
  | 'Done';

export const JOB_STEPS: readonly JobStep[] = [
  'Fetching video',
  'Transcribing',
  'Finding best moments',
  'Cutting and formatting',
  'Done',
] as const;

export interface SourceCopyrightInfo {
  videoId: string;
  title: string;
  channelName: string;
  channelId?: string;
  canonicalUrl: string;
  sourceLicense: YouTubeLicenseType | 'unknown';
  category?: string;
  hasLicensedMusicSignals: boolean;
  audioMode: AudioMode;
}

export interface CreateJobPayload {
  url: string;
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout: VideoLayout;
  audioMode: AudioMode;
  customAudioTrackId?: string;
}

export interface UploadedAudioTrackResponse {
  audioTrackId: string;
  filename: string;
  format: string;
  sizeBytes: number;
}

export interface CreateJobResponse {
  jobId: string;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface ClipItem {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl?: string;
  videoId?: string;
  playbackMode?: 'mp4' | 'youtube-embed';
  duration: number;
  score: number;
  caption: string;
  captionsEnabled?: boolean;
  captionCues?: CaptionCue[];
  startTime?: number;
  endTime?: number;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface JobResponse {
  status: JobStatus;
  step: JobStep;
  progress: number;
  clips: ClipItem[];
  sourceCopyright?: SourceCopyrightInfo;
  error?: string;
}

export type SocialPlatform = 'youtube' | 'instagram' | 'facebook';
export type OAuthProvider = 'youtube' | 'meta';
export type YouTubePrivacyStatus = 'public' | 'unlisted' | 'private';

export interface SocialMetaPageOption {
  pageId: string;
  pageName: string;
  pictureUrl?: string;
  hasInstagram: boolean;
  instagramUsername?: string;
}

export interface SocialAccountsState {
  configured: {
    youtube: boolean;
    meta: boolean;
  };
  redirectUris: {
    youtube: string;
    meta: string;
  };
  youtube: {
    connected: true;
    channelId: string;
    channelTitle: string;
    thumbnailUrl?: string;
    connectedAt: string;
  } | null;
  facebook: {
    connected: true;
    pageId: string;
    pageName: string;
    pictureUrl?: string;
    connectedAt: string;
  } | null;
  instagram: {
    connected: true;
    accountId: string;
    username: string;
    name?: string;
    profilePictureUrl?: string;
    linkedPageName: string;
    connectedAt: string;
  } | null;
  metaPages: SocialMetaPageOption[];
  selectedMetaPageId: string | null;
}

export interface PublishClipPayload {
  platform: SocialPlatform;
  jobId: string;
  clipIndex: number;
  title: string;
  caption: string;
  privacyStatus?: YouTubePrivacyStatus;
  license?: YouTubeLicenseType;
}

export interface PublishClipResponse {
  ok: true;
  platform: SocialPlatform;
  externalId: string;
  publishedUrl: string;
  studioEditUrl?: string;
  accountLabel: string;
}

export interface YouTubeUploadedVideoStatus {
  videoId: string;
  uploadStatus: string;
  privacyStatus: string;
  license: string;
  licensedContent: boolean;
  rejectionReason?: string;
  blockedRegionsCount: number;
  studioEditUrl: string;
  checkedAt: string;
}

