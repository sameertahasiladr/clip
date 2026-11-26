import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './server/src/app.js';
import { logger } from './server/src/logger.js';
import { errorHandler } from './server/src/middleware/errorHandler.js';
import { createJobQueue } from './server/src/queue/jobQueue.js';
import { InMemoryJobStore } from './server/src/queue/jobStore.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));

  const store = new InMemoryJobStore();
  const queue = await createJobQueue(store);

  // Mount real ClipGenie backend API routes
  app.use('/api', createApiRouter({ store, queue }));
  app.use('/api', errorHandler);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info('ClipGenie full-stack server listening', {
      port: PORT,
      mode: process.env.NODE_ENV ?? 'development',
      queueMode: queue.mode,
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

void startServer().catch((err) => {
  logger.error('Failed to start full-stack server', {
    error: err instanceof Error ? err.message : 'unknown',
  });
  process.exit(1);
});
