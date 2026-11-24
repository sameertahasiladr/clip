export type ClipLength = 15 | 30;

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

export interface CreateJobPayload {
  url: string;
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
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
}

export interface JobResponse {
  status: JobStatus;
  step: JobStep;
  progress: number;
  clips: ClipItem[];
  error?: string;
}

export type SocialPlatform = 'youtube' | 'instagram' | 'facebook';
