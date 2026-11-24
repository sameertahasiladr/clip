import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { createJobQueue } from './queue/jobQueue.js';
import { InMemoryJobStore } from './queue/jobStore.js';

async function start(): Promise<void> {
  const store = new InMemoryJobStore();
  const queue = await createJobQueue(store);
  const app = createApp({ store, queue });

  const server = app.listen(config.port, () => {
    logger.info('ClipGenie server listening', {
      port: config.port,
      allowedOrigins: config.allowedOrigins,
      queueMode: queue.mode,
      claudeModel: config.claudeModel,
    });
  });

  const shutdown = async (signal: string) => {
    logger.info('Shutting down ClipGenie server', { signal });
    server.close();
    await queue.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void start().catch((err) => {
  logger.error('Failed to start ClipGenie server', {
    error: err instanceof Error ? err.message : 'unknown',
  });
  process.exit(1);
});
