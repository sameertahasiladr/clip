import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { processClipJob } from '../pipeline/processJob.js';
import type { JobStore } from './jobStore.js';

export interface ClipJobQueue {
  readonly mode: 'bullmq' | 'memory';
  enqueue(jobId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Sequential in-memory fallback queue used automatically when Redis is not configured or unavailable.
 */
export class InMemoryClipQueue implements ClipJobQueue {
  readonly mode = 'memory' as const;
  private readonly pending: string[] = [];
  private isDraining = false;

  constructor(private readonly handler: (jobId: string) => Promise<void>) {}

  async enqueue(jobId: string): Promise<void> {
    this.pending.push(jobId);
    if (!this.isDraining) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.isDraining = true;
    try {
      while (this.pending.length > 0) {
        const nextJobId = this.pending.shift();
        if (!nextJobId) continue;
        try {
          await this.handler(nextJobId);
        } catch (err) {
          logger.error('Unhandled error in in-memory queue worker', {
            jobId: nextJobId,
            error: err instanceof Error ? err.message : 'unknown',
          });
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  async close(): Promise<void> {
    this.pending.length = 0;
  }
}

/**
 * Initializes BullMQ + Redis when REDIS_URL is reachable, otherwise falls back cleanly to InMemoryClipQueue.
 */
export async function createJobQueue(store: JobStore): Promise<ClipJobQueue> {
  const runJob = (jobId: string) => processClipJob(jobId, store);

  if (!config.redisUrl) {
    logger.info('REDIS_URL not set; using in-memory job queue');
    return new InMemoryClipQueue(runJob);
  }

  let probeClient: Redis | null = null;
  try {
    probeClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      connectTimeout: 2500,
    });
    await probeClient.connect();
    await probeClient.ping();
    await probeClient.quit();
  } catch (err) {
    logger.warn('Redis unavailable; falling back to in-memory job queue', {
      reason: err instanceof Error ? err.message : 'connection failed',
    });
    if (probeClient) {
      probeClient.disconnect();
    }
    return new InMemoryClipQueue(runJob);
  }

  const connection = { url: config.redisUrl };
  const queueName = 'clipgenie-jobs';
  const queue = new Queue<{ jobId: string }>(queueName, { connection });
  const worker = new Worker<{ jobId: string }>(
    queueName,
    async (bullJob) => {
      await runJob(bullJob.data.jobId);
    },
    { connection, concurrency: 2 }
  );

  worker.on('failed', (bullJob, err) => {
    logger.error('BullMQ worker job failed', {
      jobId: bullJob?.data?.jobId,
      error: err.message,
    });
  });

  logger.info('Connected to Redis; using BullMQ background queue');

  return {
    mode: 'bullmq',
    async enqueue(jobId: string): Promise<void> {
      await queue.add('generate-clips', { jobId }, { jobId, removeOnComplete: 50, removeOnFail: 50 });
    },
    async close(): Promise<void> {
      await worker.close();
      await queue.close();
    },
  };
}
