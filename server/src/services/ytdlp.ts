import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { TranscriptSegment } from '../types.js';

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  id: string;
  title: string;
  duration: number;
}

function assertPathInside(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Attempted filesystem access outside the job working directory.');
  }
  return resolvedTarget;
}

export function isValidProxyUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'socks5:' ||
      parsed.protocol === 'socks5h:'
    );
  } catch {
    return false;
  }
}

/**
 * Resolves a Netscape cookies.txt path for yt-dlp from either YTDLP_COOKIES_PATH
 * or base64-encoded YTDLP_COOKIES_B64 (decoded safely inside the per-job temp folder).
 */
export async function resolveCookiesFile(jobDir?: string): Promise<string | null> {
  const cookiesPath = process.env.YTDLP_COOKIES_PATH?.trim() || config.ytdlpCookiesPath;
  if (cookiesPath) {
    try {
      await fs.access(cookiesPath);
      return cookiesPath;
    } catch {
      logger.warn('YTDLP_COOKIES_PATH is set but file is not readable');
    }
  }

  const rawOrB64 = process.env.YTDLP_COOKIES_B64?.trim() || config.ytdlpCookiesB64;
  if (rawOrB64 && jobDir) {
    try {
      const looksRaw = rawOrB64.includes('\t') && rawOrB64.includes('youtube.com');
      const decoded = looksRaw ? rawOrB64 : Buffer.from(rawOrB64, 'base64').toString('utf8');
      if (decoded.trim().length > 0) {
        const cookieFile = assertPathInside(jobDir, path.join(jobDir, 'cookies.txt'));
        await fs.writeFile(cookieFile, decoded, { encoding: 'utf8', mode: 0o600 });
        return cookieFile;
      }
    } catch {
      logger.warn('Failed to decode YTDLP_COOKIES_B64 into temporary cookies file');
    }
  }

  return null;
}

async function buildYtDlpBaseArgs(jobDir?: string): Promise<string[]> {
  const args = [
    '--force-ipv4',
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes',
    'node',
    '--extractor-args',
    'youtube:player_client=android_vr,android,ios,mweb,web',
  ];

  const cookiesFile = await resolveCookiesFile(jobDir);
  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  }

  const proxyUrl = process.env.YTDLP_PROXY?.trim() || config.ytdlpProxy;
  if (proxyUrl && isValidProxyUrl(proxyUrl)) {
    args.push('--proxy', proxyUrl);
  }

  return args;
}

/**
 * Fetches video metadata via yt-dlp without downloading the media file.
 * Enforces the 60-minute maximum duration limit.
 */
export async function fetchVideoMetadata(
  canonicalUrl: string,
  jobDir?: string
): Promise<VideoMetadata> {
  const baseArgs = await buildYtDlpBaseArgs(jobDir);
  const { stdout } = await execFileAsync(
    'yt-dlp',
    ['--dump-single-json', ...baseArgs, '--', canonicalUrl],
    { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 }
  );

  const parsed = JSON.parse(stdout) as {
    id?: string;
    title?: string;
    duration?: number;
    is_live?: boolean;
  };

  if (parsed.is_live) {
    throw new Error('Live streams cannot be clipped. Wait until the broadcast finishes.');
  }

  const duration = typeof parsed.duration === 'number' ? parsed.duration : 0;
  if (duration <= 0) {
    throw new Error('Could not determine video duration from YouTube.');
  }

  if (duration > config.maxVideoDurationSeconds) {
    throw new Error('Videos longer than 60 minutes are not supported.');
  }

  return {
    id: parsed.id ?? 'video',
    title: parsed.title ?? 'YouTube Video',
    duration,
  };
}

export const YTDLP_BEST_QUALITY_FORMAT = 'bestvideo+bestaudio/best';
export const YTDLP_QUALITY_SORT = 'res,fps,vbr,abr,ext:mp4:m4a';

/**
 * Downloads the highest available YouTube video & audio quality (including 4K/1440p/1080p60)
 * losslessly remuxed into the confined job directory.
 */
export async function downloadVideo(canonicalUrl: string, jobDir: string): Promise<string> {
  const outputTemplate = assertPathInside(jobDir, path.join(jobDir, 'source.%(ext)s'));
  const baseArgs = await buildYtDlpBaseArgs(jobDir);

  await execFileAsync(
    'yt-dlp',
    [
      ...baseArgs,
      '-f',
      YTDLP_BEST_QUALITY_FORMAT,
      '-S',
      YTDLP_QUALITY_SORT,
      '--merge-output-format',
      'mkv',
      '-o',
      outputTemplate,
      '--',
      canonicalUrl,
    ],
    { maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60_000 }
  );

  // Locate the highest-quality merged source file (source.mkv, source.mp4, or source.webm)
  const candidates = ['source.mkv', 'source.mp4', 'source.webm'];
  for (const name of candidates) {
    const candidatePath = assertPathInside(jobDir, path.join(jobDir, name));
    try {
      const stat = await fs.stat(candidatePath);
      if (stat.size > 10_000) {
        return candidatePath;
      }
    } catch {
      // Check next extension
    }
  }

  const files = await fs.readdir(jobDir);
  const matched = files.find((f) => f.startsWith('source.') && !f.endsWith('.part'));
  if (!matched) {
    throw new Error('yt-dlp finished without producing a video file.');
  }
  return assertPathInside(jobDir, path.join(jobDir, matched));
}

function parseTimestampToSeconds(ts: string): number {
  const clean = ts.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] ?? 0;
}

/**
 * Parses WebVTT or SRT subtitle text into deduplicated timestamped transcript segments.
 */
export function parseSubtitlesToSegments(rawText: string): TranscriptSegment[] {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const [rawStart, rawEndPart] = timeLine.split('-->');
    if (!rawStart || !rawEndPart) continue;

    const rawEnd = rawEndPart.trim().split(/\s+/)[0] ?? '';
    const start = parseTimestampToSeconds(rawStart);
    const end = parseTimestampToSeconds(rawEnd);
    if (end <= start) continue;

    const text = lines
      .slice(timeLineIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;

    const previous = segments[segments.length - 1];
    if (previous && previous.text === text) {
      previous.end = Math.max(previous.end, end);
      continue;
    }

    segments.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text,
    });
  }

  return segments;
}

/**
 * Attempts to fetch English manual or auto-generated YouTube captions via yt-dlp.
 * Returns null if no usable caption track exists so the pipeline can fall back to Whisper.
 */
export async function tryFetchYouTubeCaptions(
  canonicalUrl: string,
  jobDir: string
): Promise<TranscriptSegment[] | null> {
  const outputTemplate = assertPathInside(jobDir, path.join(jobDir, 'captions.%(ext)s'));

  try {
    const baseArgs = await buildYtDlpBaseArgs(jobDir);
    await execFileAsync(
      'yt-dlp',
      [
        ...baseArgs,
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'en,en-orig,en-US,en-GB,en.*',
        '--sub-format',
        'vtt/srt/best',
        '-o',
        outputTemplate,
        '--',
        canonicalUrl,
      ],
      { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 }
    );

    const files = await fs.readdir(jobDir);
    const subtitleFiles = files
      .filter(
        (name) => name.startsWith('captions.') && (name.endsWith('.vtt') || name.endsWith('.srt'))
      )
      .sort((a, b) => {
        const aNative = /^captions\.en(?:-orig|-US|-GB)?\./i.test(a) ? 0 : 1;
        const bNative = /^captions\.en(?:-orig|-US|-GB)?\./i.test(b) ? 0 : 1;
        return aNative - bNative;
      });

    const subtitleFile = subtitleFiles[0];
    if (!subtitleFile) {
      return null;
    }

    const subtitlePath = assertPathInside(jobDir, path.join(jobDir, subtitleFile));
    const content = await fs.readFile(subtitlePath, 'utf8');
    const segments = parseSubtitlesToSegments(content);
    return segments.length > 0 ? segments : null;
  } catch (err) {
    logger.warn('YouTube captions unavailable, will fall back to Whisper', {
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}
