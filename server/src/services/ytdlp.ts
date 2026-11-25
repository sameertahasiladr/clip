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

export interface YtDlpCommand {
  bin: string;
  prefixArgs: string[];
}

let cachedYtDlpCmd: YtDlpCommand | null | undefined;

/**
 * Resolves a working yt-dlp executable across Linux, macOS, and Windows
 * (supports yt-dlp in PATH as well as python/py/python3 -m yt_dlp).
 */
export async function resolveYtDlpCommand(): Promise<YtDlpCommand | null> {
  if (cachedYtDlpCmd !== undefined) return cachedYtDlpCmd;

  const candidates: YtDlpCommand[] = [
    { bin: 'yt-dlp', prefixArgs: [] },
    { bin: 'python', prefixArgs: ['-m', 'yt_dlp'] },
    { bin: 'py', prefixArgs: ['-m', 'yt_dlp'] },
    { bin: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
  ];

  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd.bin, [...cmd.prefixArgs, '--version'], { timeout: 4000 });
      cachedYtDlpCmd = cmd;
      return cmd;
    } catch {
      // Try next executable candidate
    }
  }

  cachedYtDlpCmd = null;
  return null;
}

async function execYtDlp(
  args: string[],
  options: { maxBuffer: number; timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  const cmd = await resolveYtDlpCommand();
  if (!cmd) {
    throw new Error('yt-dlp is not installed on this system.');
  }
  return execFileAsync(cmd.bin, [...cmd.prefixArgs, ...args], options);
}

async function buildYtDlpBaseArgs(jobDir?: string): Promise<string[]> {
  const args = [
    '--force-ipv4',
    '--no-playlist',
    '--no-warnings',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--extractor-retries',
    '2',
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
  const { stdout } = await execYtDlp(
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

export const YTDLP_DOWNLOAD_STRATEGIES: ReadonlyArray<{
  name: string;
  extraArgs: string[];
  format: string;
  sort: string;
}> = [
  {
    // 1. yt-dlp's own built-in latest default client stack & JS challenge solver
    name: 'default',
    extraArgs: [],
    format: YTDLP_BEST_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 2. Safari + TV HLS streams (1080p/4K HLS bypasses HTTPS adaptive GVS PO-token 403s)
    name: 'web_safari-hls',
    extraArgs: ['--rm-cache-dir', '--extractor-args', 'youtube:player_client=web_safari,tv'],
    format: 'bestvideo[protocol^=m3u8]+bestaudio[protocol^=m3u8]/bestvideo+bestaudio/best',
    sort: 'res,fps,vbr,abr',
  },
  {
    // 3. iOS + TV HLS streams (1080p/4K HLS fallback)
    name: 'ios-hls',
    extraArgs: ['--extractor-args', 'youtube:player_client=ios,tv'],
    format:
      'bestvideo[protocol^=m3u8]+bestaudio[protocol^=m3u8]/best[protocol^=m3u8]/bestvideo+bestaudio/best',
    sort: 'res,fps,vbr,abr',
  },
  {
    // 4. Embedded TV / mobile web / VR direct fallback
    name: 'tv_embedded-fallback',
    extraArgs: ['--extractor-args', 'youtube:player_client=tv_embedded,mweb,android_vr'],
    format: YTDLP_BEST_QUALITY_FORMAT,
    sort: 'res,fps,vbr,abr',
  },
];

async function cleanupPartialSourceFiles(jobDir: string): Promise<void> {
  try {
    const files = await fs.readdir(jobDir);
    await Promise.all(
      files
        .filter((name) => name.startsWith('source.'))
        .map((name) => fs.rm(assertPathInside(jobDir, path.join(jobDir, name)), { force: true }))
    );
  } catch {
    // Ignore cleanup errors between retries
  }
}

async function locateDownloadedSourceFile(jobDir: string): Promise<string | null> {
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
  if (!matched) return null;

  const matchedPath = assertPathInside(jobDir, path.join(jobDir, matched));
  const stat = await fs.stat(matchedPath);
  return stat.size > 10_000 ? matchedPath : null;
}

/**
 * Downloads the highest available YouTube video & audio quality (including 4K/1440p/1080p60)
 * losslessly remuxed into the confined job directory, automatically retrying HLS & alternative
 * player client strategies if YouTube returns HTTP 403 on HTTPS adaptive formats.
 */
export async function downloadVideo(canonicalUrl: string, jobDir: string): Promise<string> {
  const outputTemplate = assertPathInside(jobDir, path.join(jobDir, 'source.%(ext)s'));
  const baseArgs = await buildYtDlpBaseArgs(jobDir);
  let lastError: unknown = null;

  for (const strategy of YTDLP_DOWNLOAD_STRATEGIES) {
    await cleanupPartialSourceFiles(jobDir);
    try {
      await execYtDlp(
        [
          ...baseArgs,
          ...strategy.extraArgs,
          '-f',
          strategy.format,
          '-S',
          strategy.sort,
          '--merge-output-format',
          'mkv',
          '-o',
          outputTemplate,
          '--',
          canonicalUrl,
        ],
        { maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60_000 }
      );

      const downloaded = await locateDownloadedSourceFile(jobDir);
      if (downloaded) {
        logger.info('yt-dlp downloaded source video successfully', {
          strategy: strategy.name,
          file: path.basename(downloaded),
        });
        return downloaded;
      }
    } catch (err) {
      lastError = err;
      logger.warn('yt-dlp strategy failed; trying next strategy', {
        strategy: strategy.name,
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('yt-dlp finished without producing a video file.');
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
    await execYtDlp(
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
