export type ClipLength = 15 | 30;

export type VideoLayout = 'vertical-fill' | 'vertical-blur';

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type JobStep =
  | 'Fetching video'
  | 'Transcribing'
  | 'Finding best moments'
  | 'Cutting and formatting'
  | 'Done';

export interface CreateJobInput {
  url: string;
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout?: VideoLayout;
  uploadedFilePath?: string;
  sourceTitle?: string;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface ClipResult {
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

export interface JobRecord {
  id: string;
  url: string;
  clipLength: ClipLength;
  clipCount: number;
  captions: boolean;
  videoLayout: VideoLayout;
  uploadedFilePath?: string;
  sourceTitle?: string;
  status: JobStatus;
  step: JobStep;
  progress: number;
  clips: ClipResult[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface MomentSelection {
  start: number;
  end: number;
  title: string;
  caption: string;
  score: number;
}
