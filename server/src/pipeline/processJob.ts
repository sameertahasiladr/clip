import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { JobStore } from '../queue/jobStore.js';
import { uploadClipToCloudinary } from '../services/cloudinary.js';
import { renderVerticalClip } from '../services/ffmpeg.js';
import { ensureEnglishTranscript, selectBestMoments } from '../services/momentSelector.js';
import { transcribeWithWhisper } from '../services/whisper.js';
import {
  downloadYouTubeStreamsToFile,
  fetchYouTubeVideoInfo,
} from '../services/youtubeFetch.js';
import { downloadVideo, tryFetchYouTubeCaptions } from '../services/ytdlp.js';
import type { CaptionCue, ClipResult, JobRecord, TranscriptSegment } from '../types.js';
import { parseCanonicalYouTubeUrl } from '../validation.js';

const execFileAsync = promisify(execFile);

export const EXPORTS_BASE_DIR = path.resolve(os.tmpdir(), 'clipgenie-exports');
export const UPLOADS_BASE_DIR = path.resolve(os.tmpdir(), 'clipgenie-uploads');

function hasCloudinaryConfig(): boolean {
  return Boolean(
    config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret
  );
}

async function isYtDlpAvailable(): Promise<boolean> {
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function probeLocalVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { timeout: 15_000 }
  );
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Could not read downloaded video duration.');
  }
  if (seconds > config.maxVideoDurationSeconds) {
    throw new Error('Videos longer than 60 minutes are not supported.');
  }
  return Math.round(seconds);
}

function buildRelativeCaptionCues(
  transcript: TranscriptSegment[],
  clipStart: number,
  clipEnd: number
): CaptionCue[] {
  return transcript
    .filter((seg) => seg.end > clipStart && seg.start < clipEnd)
    .map((seg) => ({
      start: Number(Math.max(0, seg.start - clipStart).toFixed(2)),
      end: Number(Math.min(clipEnd - clipStart, seg.end - clipStart).toFixed(2)),
      text: seg.text.toUpperCase(),
    }))
    .filter((cue) => cue.end > cue.start && cue.text.length > 0);
}

async function persistLocalClipExport(
  jobId: string,
  clipIndex: number,
  videoPath: string,
  posterPath: string | null
): Promise<{ videoUrl: string; posterUrl?: string }> {
  const jobExportDir = path.resolve(EXPORTS_BASE_DIR, jobId);
  if (!jobExportDir.startsWith(EXPORTS_BASE_DIR + path.sep)) {
    throw new Error('Unsafe export directory path.');
  }

  await fs.mkdir(jobExportDir, { recursive: true });

  const mp4Filename = `clip-${clipIndex + 1}.mp4`;
  const targetMp4 = path.resolve(jobExportDir, mp4Filename);
  if (!targetMp4.startsWith(jobExportDir + path.sep)) {
    throw new Error('Unsafe export MP4 path.');
  }
  await fs.copyFile(videoPath, targetMp4);

  let posterUrl: string | undefined;
  if (posterPath) {
    const jpgFilename = `clip-${clipIndex + 1}.jpg`;
    const targetJpg = path.resolve(jobExportDir, jpgFilename);
    if (targetJpg.startsWith(jobExportDir + path.sep)) {
      await fs.copyFile(posterPath, targetJpg);
      posterUrl = `/api/jobs/${jobId}/clips/${jpgFilename}`;
    }
  }

  return {
    videoUrl: `/api/jobs/${jobId}/clips/${mp4Filename}`,
    posterUrl,
  };
}

/**
 * Executes the full server-side ClipGenie YouTube pipeline:
 * 1. Fetch YouTube metadata & download the actual YouTube video into jobDir/source.mp4 (yt-dlp or direct stream)
 * 2. Extract timestamped captions (YouTube captions -> yt-dlp subs -> Whisper fallback on source.mp4)
 * 3. Select all N non-overlapping moments (Claude -> Gemini -> real transcript/chapter scorer + top-up)
 * 4. Cut & format every moment from local source.mp4 into 9:16 vertical H.264/AAC MP4 clips with ffmpeg
 * 5. Upload each MP4 to Cloudinary (when configured) or serve locally via /api/jobs/:id/clips/:filename
 * 6. Always delete temporary downloaded source video and working files in finally
 */
export async function processClipJob(jobId: string, store: JobStore): Promise<void> {
  const job: JobRecord | null = await store.get(jobId);
  if (!job) {
    logger.warn('Skipping unknown job ID', { jobId });
    return;
  }

  const baseTempRoot = path.resolve(os.tmpdir(), 'clipgenie-jobs');
  const jobDir = path.resolve(baseTempRoot, jobId);

  if (!jobDir.startsWith(baseTempRoot + path.sep)) {
    throw new Error('Unsafe job working directory path.');
  }

  await fs.mkdir(jobDir, { recursive: true });

  try {
    const parsedUrl = parseCanonicalYouTubeUrl(job.url);
    if (!parsedUrl.valid || !parsedUrl.videoId || !parsedUrl.canonicalUrl) {
      throw new Error(parsedUrl.error ?? 'Invalid YouTube URL.');
    }

    const { videoId, canonicalUrl } = parsedUrl;

    await store.updateProgress(jobId, {
      status: 'processing',
      step: 'Fetching video',
      progress: 12,
    });

    logger.info('Starting server-side YouTube clip job', {
      jobId,
      videoId,
      clipLength: job.clipLength,
      clipCount: job.clipCount,
      captions: job.captions,
    });

    const videoInfo = await fetchYouTubeVideoInfo(videoId, canonicalUrl);
    let transcript: TranscriptSegment[] = videoInfo.transcript;
    let videoDuration = videoInfo.duration;
    let downloadedVideoPath: string | null = null;
    let ytDlpErrorReason = '';

    await store.updateProgress(jobId, {
      step: 'Fetching video',
      progress: 20,
    });

    // Stage 1b: Download the real YouTube video to jobDir/source.mp4 on the server
    const ytdlpInstalled = await isYtDlpAvailable();
    if (ytdlpInstalled) {
      try {
        downloadedVideoPath = await downloadVideo(canonicalUrl, jobDir);
        logger.info('Downloaded YouTube video via yt-dlp', { jobId, videoId });
      } catch (err) {
        ytDlpErrorReason = err instanceof Error ? err.message : 'yt-dlp download failed';
        logger.warn('yt-dlp download failed; checking direct YouTube stream', {
          jobId,
          videoId,
          reason: ytDlpErrorReason,
        });
      }
    }

    if (!downloadedVideoPath && videoInfo.streamUrl) {
      try {
        downloadedVideoPath = await downloadYouTubeStreamsToFile({
          videoStreamUrl: videoInfo.streamUrl,
          audioStreamUrl: videoInfo.audioStreamUrl,
          userAgent: videoInfo.streamUserAgent,
          cookieHeader: videoInfo.cookieHeader,
          jobDir,
        });
        logger.info('Downloaded YouTube video via direct stream into server temp folder', {
          jobId,
          videoId,
        });
      } catch (err) {
        logger.warn('Direct stream download to server failed', {
          jobId,
          videoId,
          reason: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    if (!downloadedVideoPath) {
      const botBlocked =
        videoInfo.botCheckBlocked ||
        /confirm you.?re not a bot|LOGIN_REQUIRED|Sign in/i.test(ytDlpErrorReason);

      if (botBlocked) {
        throw new Error(
          'YouTube blocked unauthenticated download from this cloud server IP ("Sign in to confirm you\'re not a bot"). To enable server-side downloading for all YouTube links from a cloud host, set YTDLP_COOKIES_B64 (base64-encoded YouTube cookies.txt) or YTDLP_PROXY in your server environment, or run ClipGenie locally with Docker (docker compose up).'
        );
      }

      throw new Error(
        'Could not download this YouTube video on the server. Make sure the video is public, under 60 minutes, and not region- or age-restricted.'
      );
    }

    // Confirm exact duration from the downloaded MP4 file
    try {
      videoDuration = await probeLocalVideoDuration(downloadedVideoPath);
    } catch (probeErr) {
      if (probeErr instanceof Error && probeErr.message.includes('60 minutes')) {
        throw probeErr;
      }
    }

    await store.updateProgress(jobId, {
      step: 'Fetching video',
      progress: 34,
    });

    // Stage 2: Transcribing
    await store.updateProgress(jobId, {
      step: 'Transcribing',
      progress: 42,
    });

    if (transcript.length === 0 && ytdlpInstalled) {
      const ytdlpTranscript = await tryFetchYouTubeCaptions(canonicalUrl, jobDir);
      if (ytdlpTranscript && ytdlpTranscript.length > 0) {
        transcript = ytdlpTranscript;
      }
    }

    if (transcript.length === 0 && config.openaiApiKey) {
      logger.info('Extracting audio and translating downloaded video to English with Whisper', {
        jobId,
      });
      transcript = await transcribeWithWhisper(downloadedVideoPath, jobDir);
    }

    if (transcript.length > 0) {
      transcript = await ensureEnglishTranscript(transcript);
    }

    await store.updateProgress(jobId, {
      step: 'Transcribing',
      progress: 56,
    });

    // Stage 3: Finding best moments (always returns all requested non-overlapping clips when duration permits)
    await store.updateProgress(jobId, {
      step: 'Finding best moments',
      progress: 66,
    });

    const moments = await selectBestMoments({
      transcript,
      chapters: videoInfo.chapters,
      clipLength: job.clipLength,
      clipCount: job.clipCount,
      videoDuration,
      videoTitle: videoInfo.title,
      author: videoInfo.author,
    });

    await store.updateProgress(jobId, {
      step: 'Finding best moments',
      progress: 74,
    });

    // Stage 4 & 5: Cutting and formatting every clip from the downloaded local source.mp4
    await store.updateProgress(jobId, {
      step: 'Cutting and formatting',
      progress: 78,
    });

    const clips: ClipResult[] = [];
    const totalMoments = moments.length;
    const useCloudinary = hasCloudinaryConfig();

    for (let index = 0; index < totalMoments; index++) {
      const moment = moments[index];
      const relativeCues = buildRelativeCaptionCues(transcript, moment.start, moment.end);
      const duration = Math.max(1, Math.round(moment.end - moment.start));

      const artifacts = await renderVerticalClip({
        sourceInput: downloadedVideoPath,
        jobDir,
        clipIndex: index,
        moment,
        transcript,
        captions: job.captions,
        resolution: '1080x1920',
      });

      if (useCloudinary) {
        const videoUrl = await uploadClipToCloudinary(artifacts.videoPath, jobId, index);
        clips.push({
          id: `${jobId}-clip-${index + 1}`,
          title: moment.title,
          videoUrl,
          posterUrl: videoInfo.thumbnailUrl,
          videoId,
          playbackMode: 'mp4',
          duration,
          score: moment.score,
          caption: moment.caption,
          captionsEnabled: job.captions,
          captionCues: relativeCues,
          startTime: Math.floor(moment.start),
          endTime: Math.ceil(moment.end),
        });
      } else {
        const exported = await persistLocalClipExport(
          jobId,
          index,
          artifacts.videoPath,
          artifacts.posterPath
        );
        clips.push({
          id: `${jobId}-clip-${index + 1}`,
          title: moment.title,
          videoUrl: exported.videoUrl,
          posterUrl: exported.posterUrl ?? videoInfo.thumbnailUrl,
          videoId,
          playbackMode: 'mp4',
          duration,
          score: moment.score,
          caption: moment.caption,
          captionsEnabled: job.captions,
          captionCues: relativeCues,
          startTime: Math.floor(moment.start),
          endTime: Math.ceil(moment.end),
        });
      }

      const clipProgress = 78 + Math.round(((index + 1) / totalMoments) * 19);
      await store.updateProgress(jobId, {
        step: 'Cutting and formatting',
        progress: Math.min(97, clipProgress),
      });
    }

    await store.updateProgress(jobId, {
      status: 'done',
      step: 'Done',
      progress: 100,
      clips,
    });

    logger.info('Completed server-side YouTube clip job', {
      jobId,
      videoId,
      clipCount: clips.length,
      requestedCount: job.clipCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected processing failure.';
    const isExpectedUpstreamRestriction =
      /YouTube blocked unauthenticated download|longer than 60 minutes|unavailable, private, or removed|could not be found or is set to private|Live streams cannot be clipped|Invalid YouTube URL/i.test(
        message
      );

    if (isExpectedUpstreamRestriction) {
      logger.warn('Clip job stopped due to upstream video restriction', { jobId, reason: message });
    } else {
      logger.error('Clip job failed', { jobId, error: message });
    }

    await store.updateProgress(jobId, {
      status: 'failed',
      error: message,
    });
  } finally {
    // Stage 6: Always delete temporary downloaded source video, cookies, and working files
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
      logger.info('Cleaned up temp files', { jobId });
    } catch (cleanupErr) {
      logger.warn('Failed to clean up temp files', {
        jobId,
        error: cleanupErr instanceof Error ? cleanupErr.message : 'unknown',
      });
    }
  }
}
