import type {
  ClipResult,
  CreateJobInput,
  JobRecord,
  JobStatus,
  JobStep,
  SourceCopyrightInfo,
  TranscriptSegment,
} from '../types.js';

export interface JobProgressPatch {
  status?: JobStatus;
  step?: JobStep;
  progress?: number;
  clips?: ClipResult[];
  sourceCopyright?: SourceCopyrightInfo;
  sourceFilePath?: string;
  sourceDuration?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  transcript?: TranscriptSegment[];
  error?: string;
}

export interface JobStore {
  create(id: string, input: CreateJobInput): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  updateProgress(id: string, patch: JobProgressPatch): Promise<JobRecord | null>;
}

/**
 * In-memory job state store with optional Redis synchronization handled at the queue layer.
 */
export class InMemoryJobStore implements JobStore {
  private readonly records = new Map<string, JobRecord>();

  async create(id: string, input: CreateJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();
    const record: JobRecord = {
      id,
      url: input.url,
      clipLength: input.clipLength,
      clipCount: input.clipCount,
      captions: input.captions,
      videoLayout: input.videoLayout ?? 'vertical-fill',
      audioMode: input.audioMode ?? 'original',
      customAudioTrackId: input.customAudioTrackId,
      uploadedFilePath: input.uploadedFilePath,
      sourceTitle: input.sourceTitle,
      status: 'queued',
      step: 'Fetching video',
      progress: 5,
      clips: [],
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(id, record);
    return { ...record };
  }

  async get(id: string): Promise<JobRecord | null> {
    const existing = this.records.get(id);
    return existing
      ? {
          ...existing,
          clips: [...existing.clips],
          ...(existing.transcript ? { transcript: [...existing.transcript] } : {}),
        }
      : null;
  }

  async updateProgress(id: string, patch: JobProgressPatch): Promise<JobRecord | null> {
    const existing = this.records.get(id);
    if (!existing) return null;

    const updated: JobRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      step: patch.step ?? existing.step,
      progress:
        typeof patch.progress === 'number'
          ? Math.min(100, Math.max(0, Math.round(patch.progress)))
          : existing.progress,
      clips: patch.clips ?? existing.clips,
      sourceCopyright: patch.sourceCopyright ?? existing.sourceCopyright,
      sourceFilePath: patch.sourceFilePath ?? existing.sourceFilePath,
      sourceDuration: patch.sourceDuration ?? existing.sourceDuration,
      sourceWidth: patch.sourceWidth ?? existing.sourceWidth,
      sourceHeight: patch.sourceHeight ?? existing.sourceHeight,
      transcript: patch.transcript ?? existing.transcript,
      error: patch.error !== undefined ? patch.error : existing.error,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, updated);
    return { ...updated };
  }
}
