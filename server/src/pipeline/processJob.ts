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
  type StreamCandidate,
} from '../services/youtubeFetch.js';
import {
  downloadVideo,
  resolveYtDlpCommand,
  tryFetchYouTubeCaptions,
} from '../services/ytdlp.js';
import type { CaptionCue, ClipResult, JobRecord, TranscriptSegment } from '../types.js';
import { parseCanonicalYouTubeUrl } from '../validation.js';

const execFileAsync = promisify(execFile);

export const EXPORTS_BASE_DIR = path.resolve(os.tmpdir(), 'clipgenie-exports');
export const UPLOADS_BASE_DIR = path.resolve(os.tmpdir(), 'clipgenie-uploads');
export const AUDIO_TRACKS_BASE_DIR = path.resolve(os.tmpdir(), 'clipgenie-audio');
export const VERTICAL_4K_WIDTH = 2160 as const;
export const VERTICAL_4K_HEIGHT = 3840 as const;
export const VERTICAL_4K_RESOLUTION = '2160x3840' as const;
export const VERTICAL_4K_TARGET_BITRATE = '35000k';

const ALLOWED_AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm'] as const;

export async function resolveCustomAudioTrackPath(trackId: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackId)) {
    return null;
  }
  for (const ext of ALLOWED_AUDIO_EXTS) {
    const candidate = path.resolve(AUDIO_TRACKS_BASE_DIR, `${trackId}${ext}`);
    if (!candidate.startsWith(AUDIO_TRACKS_BASE_DIR + path.sep)) continue;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next supported extension
    }
  }
  return null;
}

function hasCloudinaryConfig(): boolean {
  return Boolean(
    config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret
  );
}

async function isYtDlpAvailable(): Promise<boolean> {
  return Boolean(await resolveYtDlpCommand());
}

async function probeLocalVideoInfo(
  filePath: string
): Promise<{ duration: number; width: number; height: number; bitrateKbps: number }> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'format=duration,bit_rate:stream=width,height,bit_rate',
      '-of',
      'json',
      filePath,
    ],
    { timeout: 15_000 }
  );
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{ width?: number; height?: number; bit_rate?: string }>;
  };
  const seconds = Number.parseFloat(parsed.format?.duration ?? '');
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Could not read downloaded video duration.');
  }
  if (seconds > config.maxVideoDurationSeconds) {
    throw new Error('Videos longer than 60 minutes are not supported.');
  }
  const rawBitrate = Number.parseInt(
    parsed.streams?.[0]?.bit_rate ?? parsed.format?.bit_rate ?? '0',
    10
  );
  return {
    duration: Math.round(seconds),
    width: parsed.streams?.[0]?.width ?? 0,
    height: parsed.streams?.[0]?.height ?? 0,
    bitrateKbps: Number.isFinite(rawBitrate) && rawBitrate > 0 ? Math.round(rawBitrate / 1000) : 0,
  };
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
    let videoId = 'uploaded';
    let canonicalUrl = job.url;
    let videoTitle = job.sourceTitle ?? 'Uploaded Video';
    let videoAuthor = 'Creator Upload';
    let thumbnailUrl: string | undefined;
    let chapters: Array<{ start: number; title: string }> = [];
    let transcript: TranscriptSegment[] = [];
    let videoDuration = 60;
    let downloadedVideoPath: string | null = null;
    let sourceWidth = 0;
    let sourceHeight = 0;
    let ytdlpInstalled = false;

    if (job.uploadedFilePath) {
      const resolvedUpload = path.resolve(job.uploadedFilePath);
      if (!resolvedUpload.startsWith(UPLOADS_BASE_DIR + path.sep)) {
        throw new Error('Unsafe uploaded video path.');
      }
      await fs.access(resolvedUpload);
      downloadedVideoPath = resolvedUpload;

      await store.updateProgress(jobId, {
        status: 'processing',
        step: 'Fetching video',
        progress: 24,
      });

      const probed = await probeLocalVideoInfo(downloadedVideoPath);
      videoDuration = probed.duration;
      sourceWidth = probed.width;
      sourceHeight = probed.height;
      logger.info('Probed uploaded source video quality', {
        jobId,
        sourceWidth,
        sourceHeight,
        duration: videoDuration,
      });
    } else {
      const parsedUrl = parseCanonicalYouTubeUrl(job.url);
      if (!parsedUrl.valid || !parsedUrl.videoId || !parsedUrl.canonicalUrl) {
        throw new Error(parsedUrl.error ?? 'Invalid YouTube URL.');
      }

      videoId = parsedUrl.videoId;
      canonicalUrl = parsedUrl.canonicalUrl;

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
      videoTitle = videoInfo.title;
      videoAuthor = videoInfo.author;
      thumbnailUrl = videoInfo.thumbnailUrl;
      chapters = videoInfo.chapters;
      transcript = videoInfo.transcript;
      videoDuration = videoInfo.duration;

      let ytDlpErrorReason = '';

      await store.updateProgress(jobId, {
        step: 'Fetching video',
        progress: 20,
        sourceCopyright: {
          videoId,
          title: videoInfo.title,
          channelName: videoInfo.author,
          channelId: videoInfo.channelId,
          canonicalUrl,
          sourceLicense: videoInfo.sourceLicense,
          category: videoInfo.category,
          hasLicensedMusicSignals: videoInfo.hasLicensedMusicSignals,
          audioMode: job.audioMode ?? 'original',
        },
      });

      const candidates: StreamCandidate[] =
        videoInfo.streamCandidates.length > 0
          ? videoInfo.streamCandidates
          : videoInfo.streamUrl
            ? [
                {
                  videoUrl: videoInfo.streamUrl,
                  audioUrl: videoInfo.audioStreamUrl,
                  height: 0,
                  userAgent: videoInfo.streamUserAgent,
                  clientName: 'DIRECT',
                },
              ]
            : [];

      const hasHdDirectCandidate = candidates.some((c) => c.height >= 1080);

      // Stage 1b: Download the highest available YouTube source video (4K/1440p/1080p)
      ytdlpInstalled = await isYtDlpAvailable();
      if (ytdlpInstalled) {
        try {
          downloadedVideoPath = await downloadVideo(canonicalUrl, jobDir, {
            allowLowResFallback: !hasHdDirectCandidate,
          });
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

      if (downloadedVideoPath) {
        try {
          const probed = await probeLocalVideoInfo(downloadedVideoPath);
          videoDuration = probed.duration;
          sourceWidth = probed.width;
          sourceHeight = probed.height;
        } catch (probeErr) {
          if (probeErr instanceof Error && probeErr.message.includes('60 minutes')) {
            throw probeErr;
          }
        }
      }

      // If yt-dlp failed OR downloaded a lower-resolution stream than an available 4K/1440p/1080p direct candidate,
      // try direct candidates that offer strictly higher resolution so we never settle for 360p/720p when 4K/1080p exists.
      let lastDirectDownloadError = '';
      const shouldTryDirectUpgrade =
        !downloadedVideoPath ||
        (sourceHeight > 0 &&
          sourceHeight < 1440 &&
          candidates.some((c) => c.height > sourceHeight));

      if (shouldTryDirectUpgrade && candidates.length > 0) {
        const directTargetDir = downloadedVideoPath
          ? path.resolve(jobDir, 'direct-hd')
          : jobDir;
        if (directTargetDir !== jobDir) {
          if (!directTargetDir.startsWith(jobDir + path.sep)) {
            throw new Error('Unsafe direct download subdirectory.');
          }
          await fs.mkdir(directTargetDir, { recursive: true });
        }

        const candidateList = downloadedVideoPath
          ? candidates.filter((c) => c.height > sourceHeight)
          : candidates;

        for (const candidate of candidateList) {
          try {
            const directPath = await downloadYouTubeStreamsToFile({
              videoStreamUrl: candidate.videoUrl,
              audioStreamUrl: candidate.audioUrl,
              isHls: candidate.isHls,
              userAgent: candidate.userAgent,
              cookieHeader: candidate.useCookies ? videoInfo.cookieHeader : undefined,
              jobDir: directTargetDir,
            });
            const directProbed = await probeLocalVideoInfo(directPath).catch(() => null);
            if (
              !downloadedVideoPath ||
              (directProbed && directProbed.height > sourceHeight)
            ) {
              downloadedVideoPath = directPath;
              if (directProbed) {
                videoDuration = directProbed.duration;
                sourceWidth = directProbed.width;
                sourceHeight = directProbed.height;
              }
              logger.info('Downloaded YouTube video via direct stream into server temp folder', {
                jobId,
                videoId,
                client: candidate.clientName,
                height: directProbed?.height ?? candidate.height,
                isHls: Boolean(candidate.isHls),
                adaptiveMux: Boolean(candidate.audioUrl),
              });
              break;
            }
          } catch (err) {
            lastDirectDownloadError = err instanceof Error ? err.message : 'unknown';
            logger.warn('Direct stream candidate download failed; trying next quality fallback', {
              jobId,
              videoId,
              client: candidate.clientName,
              height: candidate.height,
              isHls: Boolean(candidate.isHls),
              reason: lastDirectDownloadError,
            });
          }
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

        if (!ytdlpInstalled && /403|Forbidden/i.test(lastDirectDownloadError)) {
          throw new Error(
            'YouTube blocked the direct server stream with HTTP 403 for this video. Install yt-dlp on your machine (Windows: winget install yt-dlp.yt-dlp or pip install -U yt-dlp) and restart the server for reliable 4K/1080p downloads.'
          );
        }

        throw new Error(
          'Could not download this YouTube video on the server. Make sure the video is public, under 60 minutes, and not region- or age-restricted.'
        );
      }

      // Confirm exact duration and resolution from the final selected source video file
      if (sourceWidth === 0 || sourceHeight === 0) {
        try {
          const probed = await probeLocalVideoInfo(downloadedVideoPath);
          videoDuration = probed.duration;
          sourceWidth = probed.width;
          sourceHeight = probed.height;
        } catch (probeErr) {
          if (probeErr instanceof Error && probeErr.message.includes('60 minutes')) {
            throw probeErr;
          }
        }
      }

      logger.info('Probed downloaded source video quality', {
        jobId,
        videoId,
        sourceWidth,
        sourceHeight,
        duration: videoDuration,
      });
      if (sourceHeight > 0 && sourceHeight < 720) {
        logger.warn(
          'Downloaded source video is below 720p; update yt-dlp (yt-dlp -U) for full 1080p/4K source quality',
          {
            jobId,
            videoId,
            sourceWidth,
            sourceHeight,
          }
        );
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
      chapters,
      clipLength: job.clipLength,
      clipCount: job.clipCount,
      videoDuration,
      videoTitle,
      author: videoAuthor,
    });

    await store.updateProgress(jobId, {
      step: 'Finding best moments',
      progress: 74,
    });

    // Stage 4 & 5: Cutting and formatting every clip from the downloaded local source into 4K 2160x3840
    await store.updateProgress(jobId, {
      step: 'Cutting and formatting',
      progress: 78,
    });

    const clips: ClipResult[] = [];
    const totalMoments = moments.length;
    const useCloudinary = hasCloudinaryConfig();

    let customAudioPath: string | undefined;
    if (job.audioMode === 'custom-audio' && job.customAudioTrackId) {
      const resolved = await resolveCustomAudioTrackPath(job.customAudioTrackId);
      if (!resolved) {
        throw new Error(
          'Uploaded royalty-free audio track was not found or expired. Please upload the audio track again.'
        );
      }
      customAudioPath = resolved;
    }

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
        videoLayout: job.videoLayout,
        audioMode: job.audioMode ?? 'original',
        customAudioPath,
        videoBitrate: VERTICAL_4K_TARGET_BITRATE,
        resolution: VERTICAL_4K_RESOLUTION,
      });

      const renderedProbe = await probeLocalVideoInfo(artifacts.videoPath).catch(() => null);
      const outputWidth = renderedProbe?.width || VERTICAL_4K_WIDTH;
      const outputHeight = renderedProbe?.height || VERTICAL_4K_HEIGHT;
      const outputBitrateKbps = renderedProbe?.bitrateKbps || undefined;

      if (
        renderedProbe &&
        (renderedProbe.width !== VERTICAL_4K_WIDTH || renderedProbe.height !== VERTICAL_4K_HEIGHT)
      ) {
        logger.warn('Rendered clip dimensions differed from expected 4K vertical 2160x3840', {
          jobId,
          clipIndex: index + 1,
          expectedWidth: VERTICAL_4K_WIDTH,
          expectedHeight: VERTICAL_4K_HEIGHT,
          actualWidth: renderedProbe.width,
          actualHeight: renderedProbe.height,
        });
      }

      logger.info('Rendered 4K vertical clip', {
        jobId,
        clipIndex: index + 1,
        sourceWidth,
        sourceHeight,
        outputWidth,
        outputHeight,
        outputBitrateKbps,
      });

      let clipVideoUrl: string;
      let clipPosterUrl: string | undefined = thumbnailUrl;

      if (useCloudinary) {
        try {
          clipVideoUrl = await uploadClipToCloudinary(artifacts.videoPath, jobId, index);
        } catch (cloudErr) {
          logger.warn('Cloudinary 4K upload failed; serving full 4K clip locally instead', {
            jobId,
            clipIndex: index + 1,
            reason: cloudErr instanceof Error ? cloudErr.message : 'unknown',
          });
          const exported = await persistLocalClipExport(
            jobId,
            index,
            artifacts.videoPath,
            artifacts.posterPath
          );
          clipVideoUrl = exported.videoUrl;
          clipPosterUrl = exported.posterUrl ?? thumbnailUrl;
        }
      } else {
        const exported = await persistLocalClipExport(
          jobId,
          index,
          artifacts.videoPath,
          artifacts.posterPath
        );
        clipVideoUrl = exported.videoUrl;
        clipPosterUrl = exported.posterUrl ?? thumbnailUrl;
      }

      clips.push({
        id: `${jobId}-clip-${index + 1}`,
        title: moment.title,
        videoUrl: clipVideoUrl,
        posterUrl: clipPosterUrl,
        videoId,
        playbackMode: 'mp4',
        duration,
        score: moment.score,
        caption: moment.caption,
        captionsEnabled: job.captions,
        captionCues: relativeCues,
        startTime: Math.floor(moment.start),
        endTime: Math.ceil(moment.end),
        width: outputWidth,
        height: outputHeight,
        bitrateKbps: outputBitrateKbps,
        sourceWidth: sourceWidth || undefined,
        sourceHeight: sourceHeight || undefined,
      });

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
