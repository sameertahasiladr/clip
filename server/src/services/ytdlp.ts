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
  supportsJsRuntimes?: boolean;
  supportsRemoteComponents?: boolean;
}

const ALLOWED_COOKIE_BROWSERS = new Set([
  'chrome',
  'chromium',
  'edge',
  'firefox',
  'brave',
  'opera',
  'vivaldi',
  'safari',
]);

export function isValidCookiesBrowser(raw: string): boolean {
  return ALLOWED_COOKIE_BROWSERS.has(raw.trim().toLowerCase());
}

let cachedYtDlpCmd: YtDlpCommand | null | undefined;

/**
 * Resolves a working yt-dlp executable across Linux, macOS, and Windows
 * (supports yt-dlp in PATH as well as python/py/python3 -m yt_dlp) and probes
 * whether it supports --js-runtimes / --remote-components (EJS solver for YouTube 1080p/4K).
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
      let supportsJsRuntimes = false;
      let supportsRemoteComponents = false;
      try {
        const { stdout: helpOut } = await execFileAsync(cmd.bin, [...cmd.prefixArgs, '--help'], {
          maxBuffer: 4 * 1024 * 1024,
          timeout: 5000,
        });
        supportsJsRuntimes = helpOut.includes('--js-runtimes');
        supportsRemoteComponents = helpOut.includes('--remote-components');
      } catch {
        // Older yt-dlp without --js-runtimes/--remote-components
      }
      cachedYtDlpCmd = {
        ...cmd,
        supportsJsRuntimes,
        supportsRemoteComponents,
      };
      return cachedYtDlpCmd;
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

async function buildYtDlpBaseArgs(
  jobDir?: string,
  options?: { forceIpv4?: boolean }
): Promise<string[]> {
  const cmd = await resolveYtDlpCommand();
  const forceIpv4 = options?.forceIpv4 ?? true;
  const args = [
    ...(forceIpv4 ? ['--force-ipv4'] : []),
    '--no-playlist',
    '--no-warnings',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--extractor-retries',
    '2',
  ];

  // Enable Node.js JS challenge solver (EJS) automatically when yt-dlp supports it so
  // YouTube serves full 1080p/1440p/4K formats instead of returning HTTP 403 or 360p-only.
  if (cmd?.supportsJsRuntimes) {
    // On Windows avoid embedding spaces/drive-letter colons (C:\Program Files\...) in RUNTIME:PATH
    const jsRuntimeArg = process.platform === 'win32' ? 'node' : `node:${process.execPath}`;
    args.push('--js-runtimes', jsRuntimeArg);
  }
  if (cmd?.supportsRemoteComponents) {
    args.push('--remote-components', 'ejs:github');
  }

  const cookiesFile = await resolveCookiesFile(jobDir);
  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  } else {
    const browser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim().toLowerCase();
    if (browser && isValidCookiesBrowser(browser)) {
      args.push('--cookies-from-browser', browser);
    }
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
export const YTDLP_HD_QUALITY_FORMAT =
  'bestvideo[height>=1440]+bestaudio/bestvideo[height>=1080]+bestaudio/bestvideo[height>=720]+bestaudio/best[height>=720]';
export const YTDLP_QUALITY_SORT = 'res,fps,vbr,abr';

export const YTDLP_DOWNLOAD_STRATEGIES: ReadonlyArray<{
  name: string;
  extraArgs: string[];
  format: string;
  sort: string;
  forceIpv4?: boolean;
  isLowResFallback?: boolean;
}> = [
  {
    // 1. yt-dlp native default + Node.js EJS solver, strictly preferring 4K (2160p) -> 1440p -> 1080p -> 720p
    name: 'default-hd',
    extraArgs: [],
    format: YTDLP_HD_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 2. Pure Android VR client — serves true 4K 2160p VP9/AV1 adaptive streams without web PO-token 403s
    name: 'android_vr-4k',
    extraArgs: ['--extractor-args', 'youtube:player_client=android_vr'],
    format: YTDLP_HD_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 3. Smart TV client — serves true 4K 2160p/1440p/1080p adaptive streams
    name: 'tv-4k',
    extraArgs: ['--extractor-args', 'youtube:player_client=tv'],
    format: YTDLP_HD_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 4. Safari HLS + adaptive fallback (bypasses HTTPS adaptive GVS PO-token 403s without clearing EJS cache)
    name: 'web_safari-hls-hd',
    extraArgs: ['--extractor-args', 'youtube:player_client=web_safari'],
    format:
      'bestvideo[height>=1080][protocol^=m3u8]+bestaudio[protocol^=m3u8]/bestvideo[height>=720][protocol^=m3u8]+bestaudio[protocol^=m3u8]/bestvideo[height>=720]+bestaudio/best[height>=720]',
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 5. iOS HLS streams (1080p/4K HLS fallback)
    name: 'ios-hls-hd',
    extraArgs: ['--extractor-args', 'youtube:player_client=ios'],
    format:
      'bestvideo[height>=1080][protocol^=m3u8]+bestaudio[protocol^=m3u8]/bestvideo[height>=720][protocol^=m3u8]+bestaudio[protocol^=m3u8]/best[height>=720][protocol^=m3u8]/bestvideo[height>=720]+bestaudio',
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 6. Mobile web client (frequently avoids desktop 403s while keeping 1080p/4K)
    name: 'mweb-hd',
    extraArgs: ['--extractor-args', 'youtube:player_client=mweb'],
    format: YTDLP_HD_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
  },
  {
    // 7. Dual-stack (IPv6-enabled) default fallback when IPv4 CGNAT is rate-limited with HTTP 403
    name: 'default-dualstack-4k',
    extraArgs: [],
    format: YTDLP_HD_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
    forceIpv4: false,
  },
  {
    // 8. Final fallback only when no HD/4K source exists via yt-dlp or direct stream
    name: 'best-any-fallback',
    extraArgs: [],
    format: YTDLP_BEST_QUALITY_FORMAT,
    sort: YTDLP_QUALITY_SORT,
    isLowResFallback: true,
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
 * losslessly remuxed into the confined job directory, automatically retrying 4K adaptive, HLS,
 * dual-stack, and alternative player client strategies if YouTube returns HTTP 403.
 */
export async function downloadVideo(
  canonicalUrl: string,
  jobDir: string,
  options?: { allowLowResFallback?: boolean }
): Promise<string> {
  const allowLowResFallback = options?.allowLowResFallback ?? true;
  const outputTemplate = assertPathInside(jobDir, path.join(jobDir, 'source.%(ext)s'));
  const ipv4BaseArgs = await buildYtDlpBaseArgs(jobDir, { forceIpv4: true });
  const dualStackBaseArgs = await buildYtDlpBaseArgs(jobDir, { forceIpv4: false });
  let lastError: unknown = null;

  for (const strategy of YTDLP_DOWNLOAD_STRATEGIES) {
    if (strategy.isLowResFallback && !allowLowResFallback) {
      continue;
    }
    await cleanupPartialSourceFiles(jobDir);
    const baseArgs = strategy.forceIpv4 === false ? dualStackBaseArgs : ipv4BaseArgs;
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
