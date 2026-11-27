import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { AppError, errorHandler } from './middleware/errorHandler.js';
import { createJobRateLimiter } from './middleware/rateLimit.js';
import {
  AUDIO_TRACKS_BASE_DIR,
  EXPORTS_BASE_DIR,
  UPLOADS_BASE_DIR,
} from './pipeline/processJob.js';
import type { ClipJobQueue } from './queue/jobQueue.js';
import type { JobStore } from './queue/jobStore.js';
import { createSocialRouter } from './routes/social.js';
import { inspectYouTubeCopyright } from './services/youtubeFetch.js';
import type { ClipLength } from './types.js';
import {
  isValidJobId,
  parseCanonicalYouTubeUrl,
  sanitizeDownloadSlug,
  validateCreateJobRequest,
} from './validation.js';

const SAFE_CLIP_FILENAME_REGEX = /^clip-(?:[1-9]|1\d|20)\.(mp4|jpg)$/;

/**
 * Verifies uploaded audio magic bytes so only valid audio tracks (MP3, WAV, M4A, OGG, FLAC, WebM)
 * can be stored for royalty-free audio replacement.
 */
export function detectUploadedAudioExtension(
  buffer: Buffer
): 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac' | 'webm' | null {
  if (buffer.length < 12) return null;

  // MP3 with ID3 tag or raw MPEG frame sync (0xFF 0xE0..0xFF)
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return 'mp3';
  }
  // WAV: RIFF....WAVE
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'wav';
  }
  // M4A/MP4 audio: ....ftyp
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'm4a';
  }
  // OGG: OggS
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'ogg';
  }
  // FLAC: fLaC
  if (buffer.subarray(0, 4).toString('ascii') === 'fLaC') {
    return 'flac';
  }
  // WebM/Matroska: 1A 45 DF A3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'webm';
  }

  return null;
}

export function createApiRouter(deps: { store: JobStore; queue: ClipJobQueue }): express.Router {
  const { store, queue } = deps;
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, queueMode: queue.mode });
  });

  router.use('/social', createSocialRouter({ jobStore: store }));

  // Fast pre-clip YouTube copyright & license check (checks channel, CC-BY vs Standard license, and music notices)
  router.post('/copyright-check', async (req, res, next) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
      const parsed = parseCanonicalYouTubeUrl(rawUrl);
      if (!parsed.valid || !parsed.videoId || !parsed.canonicalUrl) {
        throw new AppError(parsed.error ?? 'Enter a valid YouTube video URL.', 400, 'INVALID_URL');
      }

      const info = await inspectYouTubeCopyright(parsed.videoId, parsed.canonicalUrl);
      res.json({
        ...info,
        audioMode: 'original',
      });
    } catch (err) {
      if (err instanceof AppError) {
        next(err);
        return;
      }
      next(
        new AppError(
          err instanceof Error ? err.message : 'Unable to check copyright details for this video.',
          502,
          'COPYRIGHT_CHECK_FAILED'
        )
      );
    }
  });

  // Uploads a creator-owned royalty-free audio track (MP3/WAV/M4A/OGG/FLAC) for safe audio replacement
  router.post(
    '/audio-tracks',
    express.raw({
      type: ['audio/*', 'application/octet-stream'],
      limit: '25mb',
    }),
    async (req, res, next) => {
      try {
        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || buffer.length < 128) {
          throw new AppError(
            'Upload a valid royalty-free audio file (MP3, WAV, M4A, OGG, or FLAC up to 25 MB).',
            400,
            'INVALID_AUDIO_UPLOAD'
          );
        }

        const ext = detectUploadedAudioExtension(buffer);
        if (!ext) {
          throw new AppError(
            'Unsupported audio file format. Please upload an MP3, WAV, M4A, OGG, or FLAC file.',
            400,
            'UNSUPPORTED_AUDIO_FORMAT'
          );
        }

        const rawName = typeof req.query.filename === 'string' ? req.query.filename : `track.${ext}`;
        const cleanFilename = rawName.replace(/[^\w.\-\s]/g, '').trim().slice(0, 80) || `track.${ext}`;

        const audioTrackId = crypto.randomUUID();
        const targetPath = path.resolve(AUDIO_TRACKS_BASE_DIR, `${audioTrackId}.${ext}`);
        if (!targetPath.startsWith(AUDIO_TRACKS_BASE_DIR + path.sep)) {
          throw new AppError('Invalid audio track path.', 400, 'INVALID_AUDIO_PATH');
        }

        await fsp.mkdir(AUDIO_TRACKS_BASE_DIR, { recursive: true });
        await fsp.writeFile(targetPath, buffer);

        logger.info('Uploaded custom royalty-free audio track', {
          audioTrackId,
          ext,
          sizeBytes: buffer.length,
        });

        res.status(201).json({
          audioTrackId,
          filename: cleanFilename,
          format: ext,
          sizeBytes: buffer.length,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/jobs', createJobRateLimiter, async (req, res, next) => {
    try {
      const validated = validateCreateJobRequest(req.body);
      if (!validated.success) {
        throw new AppError(validated.error, 400, 'VALIDATION_ERROR');
      }

      const jobId = crypto.randomUUID();
      await store.create(jobId, validated.data);
      await queue.enqueue(jobId);

      logger.info('Enqueued clip generation job', {
        jobId,
        videoId: validated.videoId,
        clipLength: validated.data.clipLength,
        clipCount: validated.data.clipCount,
        captions: validated.data.captions,
        videoLayout: validated.data.videoLayout ?? 'vertical-fill',
        audioMode: validated.data.audioMode ?? 'original',
        queueMode: queue.mode,
      });

      res.status(202).json({ jobId });
    } catch (err) {
      next(err);
    }
  });

  // Direct video upload endpoint so users can cut & download real 9:16 MP4 clips from any local video file
  router.post(
    '/jobs/upload',
    createJobRateLimiter,
    express.raw({
      type: ['video/*', 'application/octet-stream'],
      limit: '150mb',
    }),
    async (req, res, next) => {
      try {
        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || buffer.length < 1024) {
          throw new AppError('Upload a valid video file (MP4, MOV, or WebM).', 400, 'INVALID_UPLOAD');
        }

        const rawLen = Number(req.query.clipLength);
        const clipLength: ClipLength = rawLen === 15 ? 15 : 30;

        const rawCount = Number(req.query.clipCount);
        const clipCount =
          Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= 20 ? rawCount : 3;

        const captions = req.query.captions !== 'false';
        const videoLayout =
          req.query.videoLayout === 'vertical-blur' ? 'vertical-blur' : 'vertical-fill';
        const audioMode = req.query.audioMode === 'mute' ? 'mute' : 'original';
        const rawFilename = typeof req.query.filename === 'string' ? req.query.filename : 'Uploaded Video';
        const cleanTitle = rawFilename.replace(/\.[^.]+$/, '').replace(/[^\w\s-]/g, ' ').trim().slice(0, 80) || 'Uploaded Video';

        const jobId = crypto.randomUUID();
        const uploadDir = path.resolve(UPLOADS_BASE_DIR, jobId);
        const uploadPath = path.resolve(uploadDir, 'source.mp4');

        if (
          !uploadDir.startsWith(UPLOADS_BASE_DIR + path.sep) ||
          !uploadPath.startsWith(uploadDir + path.sep)
        ) {
          throw new AppError('Invalid upload path.', 400, 'INVALID_UPLOAD_PATH');
        }

        await fsp.mkdir(uploadDir, { recursive: true });
        await fsp.writeFile(uploadPath, buffer);

        await store.create(jobId, {
          url: `Uploaded: ${cleanTitle}`,
          clipLength,
          clipCount,
          captions,
          videoLayout,
          audioMode,
          uploadedFilePath: uploadPath,
          sourceTitle: cleanTitle,
        });
        await queue.enqueue(jobId);

        logger.info('Enqueued uploaded video clip job', {
          jobId,
          sizeBytes: buffer.length,
          clipLength,
          clipCount,
          captions,
        });

        res.status(202).json({ jobId });
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/jobs/:id', async (req, res, next) => {
    try {
      const jobId = req.params.id;
      if (!isValidJobId(jobId)) {
        throw new AppError('Invalid job ID format.', 400, 'INVALID_JOB_ID');
      }

      const record = await store.get(jobId);
      if (!record) {
        throw new AppError('Job not found.', 404, 'JOB_NOT_FOUND');
      }

      res.json({
        status: record.status,
        step: record.step,
        progress: record.progress,
        clips: record.clips,
        ...(record.sourceCopyright ? { sourceCopyright: record.sourceCopyright } : {}),
        ...(record.error ? { error: record.error } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  // Serves locally rendered 9:16 MP4 clips & poster frames with strict path confinement,
  // HTTP Range streaming, and synchronous attachment downloads
  router.get('/jobs/:id/clips/:filename', (req, res, next) => {
    try {
      const { id, filename } = req.params;
      if (!isValidJobId(id) || !SAFE_CLIP_FILENAME_REGEX.test(filename)) {
        throw new AppError('Invalid clip path.', 400, 'INVALID_CLIP_PATH');
      }

      const jobDir = path.resolve(EXPORTS_BASE_DIR, id);
      const filePath = path.resolve(jobDir, filename);
      if (
        !jobDir.startsWith(EXPORTS_BASE_DIR + path.sep) ||
        !filePath.startsWith(jobDir + path.sep)
      ) {
        throw new AppError('Forbidden clip path.', 403, 'FORBIDDEN_PATH');
      }

      if (!fs.existsSync(filePath)) {
        throw new AppError('Clip file not found.', 404, 'CLIP_NOT_FOUND');
      }

      const stat = fs.statSync(filePath);
      const isMp4 = filename.endsWith('.mp4');
      const contentType = isMp4 ? 'video/mp4' : 'image/jpeg';

      if (req.query.download === '1' && isMp4) {
        const slug = sanitizeDownloadSlug(
          typeof req.query.name === 'string' ? req.query.name : undefined
        );
        res.setHeader('Content-Disposition', `attachment; filename="${slug}.mp4"`);
      }

      const range = req.headers.range;
      if (range && isMp4 && req.query.download !== '1') {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = Number.parseInt(parts[0], 10);
        const end = parts[1] ? Number.parseInt(parts[1], 10) : stat.size - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
          res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createApp(deps: { store: JobStore; queue: ClipJobQueue }): Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError('Origin not allowed by CORS policy.', 403, 'CORS_FORBIDDEN'));
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    })
  );

  app.use(express.json({ limit: '32kb' }));
  app.use('/api', createApiRouter(deps));

  app.use((_req, _res, next) => {
    next(new AppError('Route not found.', 404, 'NOT_FOUND'));
  });

  app.use(errorHandler);

  return app;
}
