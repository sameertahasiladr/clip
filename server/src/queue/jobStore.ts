import type { ClipResult, CreateJobInput, JobRecord, JobStatus, JobStep } from '../types.js';

export interface JobStore {
  create(id: string, input: CreateJobInput): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  updateProgress(
    id: string,
    patch: { status?: JobStatus; step?: JobStep; progress?: number; clips?: ClipResult[]; error?: string }
  ): Promise<JobRecord | null>;
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
    return existing ? { ...existing, clips: [...existing.clips] } : null;
  }

  async updateProgress(
    id: string,
    patch: { status?: JobStatus; step?: JobStep; progress?: number; clips?: ClipResult[]; error?: string }
  ): Promise<JobRecord | null> {
    const existing = this.records.get(id);
    if (!existing) return null;

    const updated: JobRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      step: patch.step ?? existing.step,
      progress: typeof patch.progress === 'number' ? Math.min(100, Math.max(0, Math.round(patch.progress))) : existing.progress,
      clips: patch.clips ?? existing.clips,
      error: patch.error !== undefined ? patch.error : existing.error,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(id, updated);
    return { ...updated };
  }
}
