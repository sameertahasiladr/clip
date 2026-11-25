import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { TranscriptSegment } from '../types.js';
import { isValidProxyUrl } from './ytdlp.js';

const execFileAsync = promisify(execFile);

export const ANDROID_INNERTUBE_UA =
  'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip';

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface YouTubeChapter {
  start: number;
  title: string;
}

export interface StreamCandidate {
  videoUrl: string;
  audioUrl: string | null;
  height: number;
  userAgent: string;
  clientName: string;
  isHls?: boolean;
  useCookies?: boolean;
}

export interface YouTubeVideoInfo {
  videoId: string;
  canonicalUrl: string;
  title: string;
  author: string;
  duration: number;
  description: string;
  thumbnailUrl: string;
  chapters: YouTubeChapter[];
  streamUrl: string | null;
  audioStreamUrl: string | null;
  streamUserAgent: string;
  streamCandidates: StreamCandidate[];
  cookieHeader?: string;
  botCheckBlocked: boolean;
  transcript: TranscriptSegment[];
}

export interface ParsedNetscapeCookie {
  domain: string;
  name: string;
  value: string;
}

/**
 * Parses a Netscape cookies.txt string and extracts YouTube/Google cookies.
 */
export function parseNetscapeCookies(rawText: string): ParsedNetscapeCookie[] {
  const cookies: ParsedNetscapeCookie[] = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const domain = parts[0].toLowerCase();
    const name = parts[5].trim();
    const value = parts[6].trim();
    if (!name) continue;
    if (
      domain === 'youtube.com' ||
      domain.endsWith('.youtube.com') ||
      domain === 'google.com' ||
      domain.endsWith('.google.com')
    ) {
      cookies.push({ domain, name, value });
    }
  }
  return cookies;
}

/**
 * Builds YouTube Cookie + SAPISIDHASH Authorization headers from a Netscape cookies.txt file.
 */
export function buildYouTubeCookieHeaders(rawText: string): {
  cookieHeader: string;
  authorization?: string;
} | null {
  const cookies = parseNetscapeCookies(rawText);
  if (cookies.length === 0) return null;

  const map = new Map<string, string>();
  for (const c of cookies) {
    map.set(c.name, c.value);
  }

  const cookieHeader = Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  const sapisid = map.get('SAPISID') || map.get('__Secure-3PAPISID') || map.get('__Secure-1PAPISID');
  let authorization: string | undefined;
  if (sapisid) {
    const ts = Math.floor(Date.now() / 1000);
    const origin = 'https://www.youtube.com';
    const digest = crypto
      .createHash('sha1')
      .update(`${ts} ${sapisid} ${origin}`)
      .digest('hex');
    authorization = `SAPISIDHASH ${ts}_${digest}`;
  }

  return { cookieHeader, authorization };
}

async function loadConfiguredYouTubeCookies(): Promise<{
  cookieHeader: string;
  authorization?: string;
} | null> {
  try {
    const cookiesPath = process.env.YTDLP_COOKIES_PATH?.trim() || config.ytdlpCookiesPath;
    if (cookiesPath) {
      const content = await fs.readFile(cookiesPath, 'utf8');
      return buildYouTubeCookieHeaders(content);
    }
    const rawOrB64 = process.env.YTDLP_COOKIES_B64?.trim() || config.ytdlpCookiesB64;
    if (rawOrB64) {
      // Accept either raw Netscape cookies.txt text or base64-encoded cookies.txt
      const looksRaw = rawOrB64.includes('\t') && rawOrB64.includes('youtube.com');
      const content = looksRaw ? rawOrB64 : Buffer.from(rawOrB64, 'base64').toString('utf8');
      return buildYouTubeCookieHeaders(content);
    }
  } catch {
    logger.warn('Could not load YouTube cookies from server config');
  }
  return null;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses YouTube timedtext XML (format="3" <p t="ms" d="ms"> or legacy <text start="s" dur="s">).
 */
export function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const body = match[2].replace(/<[^>]+>/g, '');
    const tMatch = attrs.match(/\bt="(\d+)"/);
    const dMatch = attrs.match(/\bd="(\d+)"/);
    if (!tMatch) continue;

    const start = Number(tMatch[1]) / 1000;
    const dur = dMatch ? Number(dMatch[1]) / 1000 : 2.5;
    const end = start + Math.max(0.5, dur);
    const text = decodeHtmlEntities(body);
    if (!text) continue;

    segments.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text,
    });
  }

  if (segments.length > 0) {
    return segments;
  }

  const textRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  while ((match = textRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const body = match[2].replace(/<[^>]+>/g, '');
    const sMatch = attrs.match(/\bstart="([\d.]+)"/);
    const dMatch = attrs.match(/\bdur="([\d.]+)"/);
    if (!sMatch) continue;

    const start = Number(sMatch[1]);
    const dur = dMatch ? Number(dMatch[1]) : 2.5;
    const end = start + Math.max(0.5, dur);
    const text = decodeHtmlEntities(body);
    if (!text) continue;

    segments.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text,
    });
  }

  return segments;
}

/**
 * Extracts timestamp chapters from a YouTube video description (e.g. "01:24 Key insight").
 */
export function parseDescriptionChapters(description: string): YouTubeChapter[] {
  const chapters: YouTubeChapter[] = [];
  const lines = description.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const m = line.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:|]?\s*(.+)$/);
    if (!m) continue;

    const hours = m[1] ? Number(m[1]) : 0;
    const mins = Number(m[2]);
    const secs = Number(m[3]);
    const title = m[4].trim();
    if (mins >= 60 || secs >= 60 || !title) continue;

    const start = hours * 3600 + mins * 60 + secs;
    chapters.push({ start, title: title.slice(0, 90) });
  }

  return chapters.sort((a, b) => a.start - b.start);
}

/**
 * Verifies a direct YouTube media stream URL belongs to HTTPS googlevideo.com before passing to ffmpeg.
 */
export function isTrustedGoogleVideoStreamUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'googlevideo.com' || host.endsWith('.googlevideo.com');
  } catch {
    return false;
  }
}

/**
 * Parses the highest video resolution height from an HLS master playlist (#EXT-X-STREAM-INF).
 */
export function parseHlsMaxHeight(m3u8Text: string): number {
  let maxHeight = 0;
  const regex = /RESOLUTION=\d+x(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(m3u8Text)) !== null) {
    const h = Number(match[1]);
    if (Number.isFinite(h) && h > maxHeight) {
      maxHeight = h;
    }
  }
  return maxHeight > 0 ? maxHeight : 1080;
}

/**
 * Extracts the IP address family (4 or 6) embedded in a signed googlevideo.com URL (`ip=` query
 * param or `/ip/<addr>/` path segment) so downloads connect over the exact same IP version
 * that YouTube bound the signature to (prevents dual-stack IPv4/IPv6 HTTP 403s).
 */
export function extractIpFamilyFromGoogleVideoUrl(rawUrl: string): 4 | 6 | undefined {
  try {
    const parsed = new URL(rawUrl);
    let ip = parsed.searchParams.get('ip') ?? '';
    if (!ip) {
      const pathMatch = parsed.pathname.match(/\/ip\/([^/]+)/);
      if (pathMatch) {
        ip = decodeURIComponent(pathMatch[1]);
      }
    }
    if (!ip) return undefined;
    if (ip.includes(':')) return 6;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return 4;
    return undefined;
  } catch {
    return undefined;
  }
}

function openHttpsStreamWithRedirects(params: {
  url: string;
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  family?: 4 | 6;
  timeoutMs: number;
  requireTrustedGoogleVideoRedirect?: boolean;
  maxRedirects?: number;
}): Promise<http.IncomingMessage> {
  const maxRedirects = params.maxRedirects ?? 5;

  const attempt = (currentUrl: string, redirectsLeft: number): Promise<http.IncomingMessage> =>
    new Promise((resolve, reject) => {
      const parsed = new URL(currentUrl);
      const req = https.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: params.method ?? 'GET',
          headers: params.headers,
          family: params.family,
          timeout: params.timeoutMs,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          if (
            (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) &&
            location &&
            redirectsLeft > 0
          ) {
            res.resume();
            let nextUrl: string;
            try {
              nextUrl = new URL(location, currentUrl).toString();
            } catch {
              reject(new Error('Invalid redirect location from YouTube media server.'));
              return;
            }
            if (
              params.requireTrustedGoogleVideoRedirect &&
              !isTrustedGoogleVideoStreamUrl(nextUrl)
            ) {
              reject(new Error('Refused redirect to untrusted host.'));
              return;
            }
            attempt(nextUrl, redirectsLeft - 1).then(resolve, reject);
            return;
          }
          resolve(res);
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`HTTPS request timed out after ${params.timeoutMs}ms`));
      });
      req.on('error', reject);

      if (params.body) {
        req.write(params.body);
      }
      req.end();
    });

  return attempt(params.url, maxRedirects);
}

async function readIncomingMessageText(res: http.IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      res.destroy();
      break;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractBalancedJson(source: string, marker: string): Record<string, unknown> | null {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return null;
  const startIdx = source.indexOf('{', markerIdx + marker.length);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIdx, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

interface RawStreamFormat {
  url?: string;
  mimeType?: string;
  height?: number;
  fps?: number;
  bitrate?: number;
}

interface InnertubePlayerData {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
    shortDescription?: string;
    isLiveContent?: boolean;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
  streamingData?: {
    formats?: RawStreamFormat[];
    adaptiveFormats?: RawStreamFormat[];
    hlsManifestUrl?: string;
  };
}

export interface ExtractedStreamPair {
  videoUrl: string;
  audioUrl: string | null;
  height: number;
  isHls?: boolean;
}

/**
 * Returns a deduplicated, quality-ordered list of stream candidates from highest resolution
 * adaptive (4K/1440p/1080p60) -> highest H.264/M4A adaptive -> HLS master playlist (1080p/4K,
 * bypasses adaptive PO-token 403s) -> highest muxed MP4 fallback.
 */
export function extractStreamCandidates(
  streamingData?: InnertubePlayerData['streamingData']
): ExtractedStreamPair[] {
  if (!streamingData) return [];

  const adaptiveVideos = (streamingData.adaptiveFormats ?? [])
    .filter(
      (f) =>
        typeof f.url === 'string' &&
        isTrustedGoogleVideoStreamUrl(f.url) &&
        ((f.mimeType?.startsWith('video/mp4') ?? false) ||
          (f.mimeType?.startsWith('video/webm') ?? false)) &&
        (f.height ?? 0) > 0
    )
    .sort((a, b) => {
      const heightDiff = (b.height ?? 0) - (a.height ?? 0);
      if (heightDiff !== 0) return heightDiff;
      const fpsDiff = (b.fps ?? 0) - (a.fps ?? 0);
      if (fpsDiff !== 0) return fpsDiff;
      const bitrateDiff = (b.bitrate ?? 0) - (a.bitrate ?? 0);
      if (bitrateDiff !== 0) return bitrateDiff;
      const aMp4 = a.mimeType?.startsWith('video/mp4') ? 1 : 0;
      const bMp4 = b.mimeType?.startsWith('video/mp4') ? 1 : 0;
      return bMp4 - aMp4;
    });

  const adaptiveAudios = (streamingData.adaptiveFormats ?? [])
    .filter(
      (f) =>
        typeof f.url === 'string' &&
        isTrustedGoogleVideoStreamUrl(f.url) &&
        ((f.mimeType?.startsWith('audio/mp4') ?? false) ||
          (f.mimeType?.startsWith('audio/webm') ?? false))
    )
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const bestM4aAudio = adaptiveAudios.find((a) => a.mimeType?.startsWith('audio/mp4'));
  const bestAnyAudio = adaptiveAudios[0];

  const muxedStreams = (streamingData.formats ?? [])
    .filter(
      (f) =>
        typeof f.url === 'string' &&
        isTrustedGoogleVideoStreamUrl(f.url) &&
        ((f.mimeType?.includes('video/mp4') ?? false) ||
          (f.mimeType?.includes('video/webm') ?? false))
    )
    .sort((a, b) => {
      const heightDiff = (b.height ?? 0) - (a.height ?? 0);
      if (heightDiff !== 0) return heightDiff;
      return (b.bitrate ?? 0) - (a.bitrate ?? 0);
    });

  const candidates: ExtractedStreamPair[] = [];
  const seenKeys = new Set<string>();
  const pushUnique = (pair: ExtractedStreamPair) => {
    const key = `${pair.videoUrl}|${pair.audioUrl ?? ''}|${pair.isHls ? 'hls' : 'http'}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      candidates.push(pair);
    }
  };

  // 1. Absolute highest resolution/fps/bitrate adaptive stream + highest bitrate audio
  if (adaptiveVideos[0]?.url && bestAnyAudio?.url) {
    pushUnique({
      videoUrl: adaptiveVideos[0].url,
      audioUrl: bestAnyAudio.url,
      height: adaptiveVideos[0].height ?? 0,
    });
  }

  // 2. Highest resolution MP4 adaptive video + M4A audio (often avoids WebM/Opus 403 or codec issues)
  const bestMp4Video = adaptiveVideos.find((v) => v.mimeType?.startsWith('video/mp4'));
  if (bestMp4Video?.url && (bestM4aAudio?.url || bestAnyAudio?.url)) {
    pushUnique({
      videoUrl: bestMp4Video.url,
      audioUrl: (bestM4aAudio ?? bestAnyAudio)!.url!,
      height: bestMp4Video.height ?? 0,
    });
  }

  // 3. 1080p MP4 adaptive fallback if top stream was 4K/1440p
  const hd1080Video = adaptiveVideos.find(
    (v) => (v.height ?? 0) <= 1080 && (v.height ?? 0) >= 720
  );
  if (hd1080Video?.url && (bestM4aAudio?.url || bestAnyAudio?.url)) {
    pushUnique({
      videoUrl: hd1080Video.url,
      audioUrl: (bestM4aAudio ?? bestAnyAudio)!.url!,
      height: hd1080Video.height ?? 0,
    });
  }

  // 4. HLS master playlist (IOS client provides 1080p/1440p/4K HLS without GVS PO-token 403s)
  if (
    typeof streamingData.hlsManifestUrl === 'string' &&
    isTrustedGoogleVideoStreamUrl(streamingData.hlsManifestUrl)
  ) {
    pushUnique({
      videoUrl: streamingData.hlsManifestUrl,
      audioUrl: null,
      height: 1080,
      isHls: true,
    });
  }

  // 5. Highest resolution muxed stream (fallback if adaptive + HLS fail)
  for (const muxed of muxedStreams.slice(0, 2)) {
    if (muxed.url) {
      pushUnique({
        videoUrl: muxed.url,
        audioUrl: null,
        height: muxed.height ?? 360,
      });
    }
  }

  return candidates.sort((a, b) => b.height - a.height);
}

export function extractBestStreams(streamingData?: InnertubePlayerData['streamingData']): {
  videoUrl: string | null;
  audioUrl: string | null;
} {
  const best = extractStreamCandidates(streamingData)[0];
  return best
    ? { videoUrl: best.videoUrl, audioUrl: best.audioUrl }
    : { videoUrl: null, audioUrl: null };
}

/**
 * Ensures a YouTube timedtext caption URL always returns English subtitles by appending
 * YouTube's official `tlang=en` translation parameter for non-English caption tracks.
 */
export function ensureEnglishCaptionUrl(baseUrl: string, languageCode?: string): string | null {
  try {
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('youtube.com')) {
      return null;
    }
    const lang = (languageCode ?? parsedUrl.searchParams.get('lang') ?? '').toLowerCase();
    if (!lang.startsWith('en') && parsedUrl.searchParams.get('tlang')?.toLowerCase() !== 'en') {
      parsedUrl.searchParams.set('tlang', 'en');
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
}

async function fetchBestCaptionTrack(
  tracks: CaptionTrack[],
  cookieHeader?: string
): Promise<TranscriptSegment[]> {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const sorted = [...tracks].sort((a, b) => {
    const aEn = (a.languageCode ?? '').toLowerCase().startsWith('en') ? 0 : 1;
    const bEn = (b.languageCode ?? '').toLowerCase().startsWith('en') ? 0 : 1;
    if (aEn !== bEn) return aEn - bEn;
    const aAuto = a.kind === 'asr' ? 1 : 0;
    const bAuto = b.kind === 'asr' ? 1 : 0;
    return aAuto - bAuto;
  });

  for (const track of sorted.slice(0, 3)) {
    if (!track.baseUrl) continue;
    const englishUrl = ensureEnglishCaptionUrl(track.baseUrl, track.languageCode);
    if (!englishUrl) continue;
    try {
      const res = await fetch(englishUrl, {
        headers: {
          'User-Agent': ANDROID_INNERTUBE_UA,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const segments = parseTimedTextXml(xml);
      if (segments.length > 0) {
        return segments;
      }
    } catch {
      // Try next track
    }
  }

  return [];
}

interface ClientSpec {
  name: string;
  ua: string;
  clientNameId?: string;
  clientVersion?: string;
  endpoint?: 'googleapis' | 'youtube';
  useAuthCookies?: boolean;
  skipVisitorData?: boolean;
  client: Record<string, unknown>;
  thirdParty?: Record<string, unknown>;
}

function getConfiguredProxy(): string | null {
  const raw = process.env.YTDLP_PROXY?.trim() || config.ytdlpProxy;
  return raw && isValidProxyUrl(raw) ? raw : null;
}

async function postJsonRequest(params: {
  url: string;
  headers: Record<string, string>;
  body: string;
  proxyUrl: string | null;
}): Promise<Record<string, unknown> | null> {
  if (params.proxyUrl) {
    const args = [
      '-sS',
      '-4',
      '--max-time',
      '15',
      '--proxy',
      params.proxyUrl,
      '-X',
      'POST',
    ];
    for (const [key, value] of Object.entries(params.headers)) {
      args.push('-H', `${key}: ${value}`);
    }
    args.push('--data-raw', params.body, '--', params.url);
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024, timeout: 18_000 });
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  // Prefer IPv4 first so signed googlevideo.com URLs bind to IPv4 consistently across Node & FFmpeg
  const requestHeaders: Record<string, string> = {
    ...params.headers,
    'Content-Length': String(Buffer.byteLength(params.body)),
  };

  let res: http.IncomingMessage;
  try {
    res = await openHttpsStreamWithRedirects({
      url: params.url,
      method: 'POST',
      headers: requestHeaders,
      body: params.body,
      family: 4,
      timeoutMs: 10_000,
    });
  } catch {
    res = await openHttpsStreamWithRedirects({
      url: params.url,
      method: 'POST',
      headers: requestHeaders,
      body: params.body,
      timeoutMs: 10_000,
    });
  }

  const status = res.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    res.resume();
    return null;
  }

  const raw = await readIncomingMessageText(res, 10 * 1024 * 1024);
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Fetches real YouTube video metadata, caption transcript, and direct MP4/adaptive streams.
 * Supports authenticated YouTube cookies (YTDLP_COOKIES_PATH / YTDLP_COOKIES_B64),
 * validated proxies (YTDLP_PROXY), and multiple Innertube clients including ANDROID_KIDS/IOS_KIDS.
 */
export async function fetchYouTubeVideoInfo(
  videoId: string,
  canonicalUrl: string
): Promise<YouTubeVideoInfo> {
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const authCookies = await loadConfiguredYouTubeCookies();

  const watchHeaders: Record<string, string> = {
    'User-Agent': WEB_UA,
    'Accept-Language': 'en-US,en;q=0.9',
    ...(authCookies?.cookieHeader ? { Cookie: authCookies.cookieHeader } : {}),
  };

  const [oembedResult, htmlResult] = await Promise.allSettled([
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
      signal: AbortSignal.timeout(10_000),
    }).then(async (r) => (r.ok ? ((await r.json()) as { title?: string; author_name?: string }) : null)),
    fetch(canonicalUrl, {
      headers: watchHeaders,
      signal: AbortSignal.timeout(12_000),
    }).then(async (r) => (r.ok ? r.text() : '')),
  ]);

  const oembed = oembedResult.status === 'fulfilled' ? oembedResult.value : null;
  const html = htmlResult.status === 'fulfilled' ? htmlResult.value : '';

  if (!oembed && !html) {
    throw new Error('Could not reach YouTube for this video link. Check that the video is public.');
  }

  const webPlayer = html
    ? (extractBalancedJson(html, 'var ytInitialPlayerResponse = ') as InnertubePlayerData | null)
    : null;
  const webVideoDetails = webPlayer?.videoDetails ?? {};
  const webPlayability = webPlayer?.playabilityStatus ?? {};

  if (webPlayability.status === 'ERROR' && !oembed) {
    throw new Error(
      webPlayability.reason || 'This YouTube video is unavailable, private, or removed.'
    );
  }

  if (webVideoDetails.isLiveContent) {
    throw new Error('Live streams cannot be clipped. Wait until the broadcast ends.');
  }

  let title = webVideoDetails.title || oembed?.title || 'YouTube Video';
  let author = webVideoDetails.author || oembed?.author_name || 'YouTube Creator';
  let duration = Number(webVideoDetails.lengthSeconds ?? 0);
  let description = webVideoDetails.shortDescription ?? '';
  let streamUrl: string | null = null;
  let audioStreamUrl: string | null = null;
  let streamUserAgent = ANDROID_INNERTUBE_UA;
  const collectedCandidates: StreamCandidate[] = [];
  let transcript: TranscriptSegment[] = [];
  let botCheckBlocked = webPlayability.status === 'LOGIN_REQUIRED';

  const proxyUrl = getConfiguredProxy();

  // Probe with the exact same GET headers & IP family used for downloading (no Range: bytes=0-0
  // mismatch, and only send Cookie when the client actually authenticated with cookies).
  const probeUrlPlayable = async (
    url: string,
    userAgent: string,
    cookieHeader?: string
  ): Promise<boolean> => {
    if (!isTrustedGoogleVideoStreamUrl(url)) return false;
    try {
      if (proxyUrl) {
        const { stdout } = await execFileAsync(
          'curl',
          [
            '-sS',
            '-4',
            '-o',
            '/dev/null',
            '-w',
            '%{http_code}',
            '--max-time',
            '8',
            '--proxy',
            proxyUrl,
            '-A',
            userAgent,
            '-H',
            'Accept: */*',
            ...(cookieHeader ? ['-H', `Cookie: ${cookieHeader}`] : []),
            '--',
            url,
          ],
          { timeout: 10_000 }
        );
        const code = Number(stdout.trim());
        return code === 200 || code === 206;
      }

      const family = extractIpFamilyFromGoogleVideoUrl(url);
      const res = await openHttpsStreamWithRedirects({
        url,
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        family,
        timeoutMs: 6_000,
        requireTrustedGoogleVideoRedirect: true,
      });
      const status = res.statusCode ?? 0;
      res.destroy();
      return status === 200 || status === 206;
    } catch {
      return false;
    }
  };

  const probeHlsManifestPlayable = async (
    url: string,
    userAgent: string,
    cookieHeader?: string
  ): Promise<number | null> => {
    if (!isTrustedGoogleVideoStreamUrl(url)) return null;
    try {
      let text = '';
      if (proxyUrl) {
        const { stdout } = await execFileAsync(
          'curl',
          [
            '-fsSL',
            '-4',
            '--max-time',
            '8',
            '--proxy',
            proxyUrl,
            '-A',
            userAgent,
            ...(cookieHeader ? ['-H', `Cookie: ${cookieHeader}`] : []),
            '--',
            url,
          ],
          { maxBuffer: 2 * 1024 * 1024, timeout: 10_000 }
        );
        text = stdout;
      } else {
        const family = extractIpFamilyFromGoogleVideoUrl(url);
        const res = await openHttpsStreamWithRedirects({
          url,
          method: 'GET',
          headers: {
            'User-Agent': userAgent,
            Accept: '*/*',
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          family,
          timeoutMs: 6_000,
          requireTrustedGoogleVideoRedirect: true,
        });
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.destroy();
          return null;
        }
        text = await readIncomingMessageText(res, 1024 * 1024);
      }

      if (!text.includes('#EXTM3U')) return null;
      return parseHlsMaxHeight(text);
    } catch {
      return null;
    }
  };

  const probeCandidatePlayable = async (candidate: StreamCandidate): Promise<boolean> => {
    const cookieHeader = candidate.useCookies ? authCookies?.cookieHeader : undefined;
    if (candidate.isHls) {
      const hlsHeight = await probeHlsManifestPlayable(
        candidate.videoUrl,
        candidate.userAgent,
        cookieHeader
      );
      if (hlsHeight === null) return false;
      candidate.height = hlsHeight;
      return true;
    }

    const videoOk = await probeUrlPlayable(candidate.videoUrl, candidate.userAgent, cookieHeader);
    if (!videoOk) return false;
    if (candidate.audioUrl) {
      return probeUrlPlayable(candidate.audioUrl, candidate.userAgent, cookieHeader);
    }
    return true;
  };

  // If authenticated watch page itself already contains direct streamingData, add its candidates
  if (webPlayability.status === 'OK' && webPlayer?.streamingData) {
    for (const pair of extractStreamCandidates(webPlayer.streamingData)) {
      collectedCandidates.push({
        ...pair,
        userAgent: WEB_UA,
        clientName: 'WEB_HTML',
        useCookies: Boolean(authCookies?.cookieHeader),
      });
    }
  }

  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const visitorData = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1];

  const clientQueue: ClientSpec[] = [];
  if (authCookies) {
    clientQueue.push(
      {
        name: 'TVHTML5_AUTH',
        ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
        clientNameId: '7',
        clientVersion: '7.20250312.16.00',
        useAuthCookies: true,
        client: {
          clientName: 'TVHTML5',
          clientVersion: '7.20250312.16.00',
          hl: 'en',
          gl: 'US',
        },
      },
      {
        name: 'ANDROID_AUTH',
        ua: ANDROID_INNERTUBE_UA,
        clientNameId: '3',
        clientVersion: '20.10.38',
        useAuthCookies: true,
        client: {
          clientName: 'ANDROID',
          clientVersion: '20.10.38',
          androidSdkVersion: 34,
          hl: 'en',
          gl: 'US',
        },
      },
      {
        name: 'MWEB_AUTH',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        clientNameId: '2',
        clientVersion: '2.20250312.01.00',
        useAuthCookies: true,
        client: {
          clientName: 'MWEB',
          clientVersion: '2.20250312.01.00',
          hl: 'en',
          gl: 'US',
        },
      }
    );
  }

  // Prioritize ANDROID_VR (direct 4K/1080p adaptive without PO-token 403), IOS (1080p/4K HLS manifest
  // without PO-token 403), and TVHTML5_SIMPLY_EMBEDDED_PLAYER (music-video friendly)
  clientQueue.push(
    {
      name: 'ANDROID_VR',
      ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      clientNameId: '28',
      clientVersion: '1.65.10',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.65.10',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        osName: 'Android',
        osVersion: '12L',
        androidSdkVersion: 32,
        hl: 'en',
        gl: 'US',
      },
    },
    {
      name: 'IOS',
      ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
      clientNameId: '5',
      clientVersion: '20.10.4',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'IOS',
        clientVersion: '20.10.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.3.2.22D82',
        hl: 'en',
        gl: 'US',
      },
    },
    {
      name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
      clientNameId: '85',
      clientVersion: '2.0',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'US',
      },
      thirdParty: {
        embedUrl: 'https://www.youtube.com/',
      },
    },
    {
      name: 'ANDROID',
      ua: ANDROID_INNERTUBE_UA,
      clientNameId: '3',
      clientVersion: '20.10.38',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US',
      },
    },
    {
      name: 'ANDROID_KIDS',
      ua: 'com.google.android.apps.youtube.kids/9.45.2 (Linux; U; Android 14) gzip',
      clientNameId: '31',
      clientVersion: '9.45.2',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'ANDROID_KIDS',
        clientVersion: '9.45.2',
        androidSdkVersion: 34,
        hl: 'en',
        gl: 'US',
      },
    },
    {
      name: 'IOS_KIDS',
      ua: 'com.google.ios.youtubekids/9.45 (iPhone16,2; U; CPU iOS 18_1 like Mac OS X)',
      clientNameId: '32',
      clientVersion: '9.45',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'IOS_KIDS',
        clientVersion: '9.45',
        hl: 'en',
        gl: 'US',
      },
    },
    {
      name: 'TVHTML5',
      ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
      clientNameId: '7',
      clientVersion: '7.20250312.16.00',
      endpoint: 'youtube',
      client: {
        clientName: 'TVHTML5',
        clientVersion: '7.20250312.16.00',
        hl: 'en',
        gl: 'US',
      },
    }
  );

  let verifiedBestCandidate: StreamCandidate | null = null;
  const verifiedCandidates: StreamCandidate[] = [];

  for (const spec of clientQueue) {
    try {
      const useGoogleApis = spec.endpoint === 'googleapis' || !apiKey;
      const playerUrl = useGoogleApis
        ? 'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false'
        : `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey!)}&prettyPrint=false`;

      const includeVisitor = !spec.skipVisitorData && Boolean(visitorData);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': spec.ua,
        ...(spec.clientNameId ? { 'X-YouTube-Client-Name': spec.clientNameId } : {}),
        ...(spec.clientVersion ? { 'X-YouTube-Client-Version': spec.clientVersion } : {}),
        ...(includeVisitor && visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
      };
      if (spec.useAuthCookies && authCookies) {
        headers.Cookie = authCookies.cookieHeader;
        headers.Origin = 'https://www.youtube.com';
        headers['X-Origin'] = 'https://www.youtube.com';
        if (authCookies.authorization) {
          headers.Authorization = authCookies.authorization;
        }
      }

      const data = (await postJsonRequest({
        url: playerUrl,
        headers,
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              ...spec.client,
              ...(includeVisitor && visitorData ? { visitorData } : {}),
            },
            ...(spec.thirdParty ? { thirdParty: spec.thirdParty } : {}),
          },
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        proxyUrl,
      })) as InnertubePlayerData | null;

      if (!data) continue;

      if (data.videoDetails?.title) title = data.videoDetails.title;
      if (data.videoDetails?.author) author = data.videoDetails.author;
      if (data.videoDetails?.lengthSeconds && Number(data.videoDetails.lengthSeconds) > 0) {
        duration = Number(data.videoDetails.lengthSeconds);
      }
      if (data.videoDetails?.shortDescription) {
        description = data.videoDetails.shortDescription;
      }

      if (data.playabilityStatus?.status === 'LOGIN_REQUIRED') {
        botCheckBlocked = true;
        continue;
      }

      if (data.playabilityStatus?.status === 'OK') {
        botCheckBlocked = false;

        if (transcript.length === 0) {
          const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
          if (tracks.length > 0) {
            transcript = await fetchBestCaptionTrack(tracks, authCookies?.cookieHeader);
          }
        }

        const pairs = extractStreamCandidates(data.streamingData);
        for (const pair of pairs) {
          const candidate: StreamCandidate = {
            ...pair,
            userAgent: spec.ua,
            clientName: spec.name,
            useCookies: Boolean(spec.useAuthCookies && authCookies?.cookieHeader),
          };
          collectedCandidates.push(candidate);

          const playable = await probeCandidatePlayable(candidate);
          if (playable) {
            verifiedCandidates.push(candidate);
            if (!verifiedBestCandidate || candidate.height > verifiedBestCandidate.height) {
              verifiedBestCandidate = candidate;
            }
            // Found a verified playable candidate on this client — no need to probe lower ones from the same client
            break;
          }
        }

        // Stop searching additional clients once we have a verified >= 1080p stream
        if (verifiedBestCandidate && verifiedBestCandidate.height >= 1080) {
          logger.info('Resolved verified high-quality YouTube video stream', {
            videoId,
            client: verifiedBestCandidate.clientName,
            height: verifiedBestCandidate.height,
            isHls: Boolean(verifiedBestCandidate.isHls),
            adaptiveMux: Boolean(verifiedBestCandidate.audioUrl),
          });
          break;
        }
      }
    } catch (err) {
      logger.warn('Innertube client attempt failed', {
        videoId,
        client: spec.name,
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  // Build final prioritized candidate list: verified playable streams (highest res first), then unverified fallbacks
  const orderedVerified = [...verifiedCandidates].sort((a, b) => b.height - a.height);
  const orderedAll = [...collectedCandidates].sort((a, b) => b.height - a.height);
  const streamCandidates: StreamCandidate[] = [];
  const seenCandidateKeys = new Set<string>();
  for (const c of [...orderedVerified, ...orderedAll]) {
    const key = `${c.videoUrl}|${c.audioUrl ?? ''}|${c.isHls ? 'hls' : 'http'}`;
    if (!seenCandidateKeys.has(key)) {
      seenCandidateKeys.add(key);
      streamCandidates.push(c);
    }
  }

  const chosen = streamCandidates[0] ?? null;
  if (chosen) {
    streamUrl = chosen.videoUrl;
    audioStreamUrl = chosen.audioUrl;
    streamUserAgent = chosen.userAgent;
    if (!verifiedBestCandidate || verifiedBestCandidate.height < 1080) {
      logger.info('Resolved direct YouTube video stream', {
        videoId,
        client: chosen.clientName,
        height: chosen.height,
        isHls: Boolean(chosen.isHls),
        verified: orderedVerified.length > 0,
        adaptiveMux: Boolean(chosen.audioUrl),
      });
    }
  }

  if (transcript.length === 0) {
    const webTracks = webPlayer?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (webTracks.length > 0) {
      transcript = await fetchBestCaptionTrack(webTracks, authCookies?.cookieHeader);
    }
  }

  if (duration <= 0) {
    const approxMatch = html.match(/"approxDurationMs":"(\d+)"/);
    if (approxMatch) {
      duration = Math.round(Number(approxMatch[1]) / 1000);
    }
  }

  if (duration > config.maxVideoDurationSeconds) {
    throw new Error('Videos longer than 60 minutes are not supported.');
  }

  if (!oembed && !webVideoDetails.title && duration <= 0) {
    throw new Error('This YouTube video could not be found or is set to private.');
  }

  const safeDuration = duration > 0 ? duration : 60;
  const chapters = parseDescriptionChapters(description);

  logger.info('Fetched YouTube video info', {
    videoId,
    title,
    duration: safeDuration,
    hasDirectStream: Boolean(streamUrl),
    streamCandidateCount: streamCandidates.length,
    botCheckBlocked,
    transcriptSegments: transcript.length,
    chapters: chapters.length,
  });

  return {
    videoId,
    canonicalUrl,
    title,
    author,
    duration: safeDuration,
    description,
    thumbnailUrl,
    chapters,
    streamUrl,
    audioStreamUrl,
    streamUserAgent,
    streamCandidates,
    cookieHeader: authCookies?.cookieHeader,
    botCheckBlocked,
    transcript,
  };
}

async function streamUrlToLocalFile(params: {
  url: string;
  targetPath: string;
  userAgent: string;
  cookieHeader?: string;
}): Promise<void> {
  const proxyUrl = getConfiguredProxy();
  if (proxyUrl) {
    const args = [
      '-fsSL',
      '-4',
      '--max-time',
      '300',
      '--proxy',
      proxyUrl,
      '-A',
      params.userAgent,
      '-H',
      'Accept: */*',
      ...(params.cookieHeader ? ['-H', `Cookie: ${params.cookieHeader}`] : []),
      '-o',
      params.targetPath,
      '--',
      params.url,
    ];
    await execFileAsync('curl', args, { timeout: 5 * 60_000 });
    return;
  }

  const family = extractIpFamilyFromGoogleVideoUrl(params.url);
  const res = await openHttpsStreamWithRedirects({
    url: params.url,
    method: 'GET',
    headers: {
      'User-Agent': params.userAgent,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      ...(params.cookieHeader ? { Cookie: params.cookieHeader } : {}),
    },
    family,
    timeoutMs: 5 * 60_000,
    requireTrustedGoogleVideoRedirect: true,
  });

  const status = res.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    res.destroy();
    throw new Error(`YouTube media download failed with HTTP ${status}`);
  }

  await pipeline(res, createWriteStream(params.targetPath));
}

/**
 * Downloads the resolved HTTPS googlevideo.com stream(s) (direct progressive, adaptive video+audio,
 * or HLS master playlist) into jobDir/source.(mkv|mp4) once on the server so ffmpeg can cut clips fast.
 */
export async function downloadYouTubeStreamsToFile(params: {
  videoStreamUrl: string;
  audioStreamUrl?: string | null;
  isHls?: boolean;
  userAgent: string;
  cookieHeader?: string;
  jobDir: string;
}): Promise<string> {
  const { videoStreamUrl, audioStreamUrl, isHls, userAgent, cookieHeader, jobDir } = params;

  if (!isTrustedGoogleVideoStreamUrl(videoStreamUrl)) {
    throw new Error('Refused untrusted video stream URL.');
  }
  if (audioStreamUrl && !isTrustedGoogleVideoStreamUrl(audioStreamUrl)) {
    throw new Error('Refused untrusted audio stream URL.');
  }

  const resolvedBase = path.resolve(jobDir);
  const outputPath = path.resolve(
    resolvedBase,
    audioStreamUrl || isHls ? 'source.mkv' : 'source.mp4'
  );
  if (!outputPath.startsWith(resolvedBase + path.sep)) {
    throw new Error('Unsafe source video output path.');
  }

  if (isHls) {
    const proxyUrl = getConfiguredProxy();
    // Do NOT pass -map 0:v:0 on a multi-variant HLS playlist: FFmpeg's default stream selection
    // automatically picks the highest-resolution video variant + best audio stream.
    const ffmpegArgs = [
      '-y',
      '-loglevel',
      'error',
      '-user_agent',
      userAgent,
      ...(cookieHeader ? ['-headers', `Cookie: ${cookieHeader}\r\n`] : []),
      ...(proxyUrl && proxyUrl.startsWith('http://') ? ['-http_proxy', proxyUrl] : []),
      '-i',
      videoStreamUrl,
      '-c',
      'copy',
      outputPath,
    ];
    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 5 * 60_000 });
  } else if (!audioStreamUrl) {
    await streamUrlToLocalFile({
      url: videoStreamUrl,
      targetPath: outputPath,
      userAgent,
      cookieHeader,
    });
  } else {
    const tempVideo = path.resolve(resolvedBase, 'video-only.bin');
    const tempAudio = path.resolve(resolvedBase, 'audio-only.bin');
    if (
      !tempVideo.startsWith(resolvedBase + path.sep) ||
      !tempAudio.startsWith(resolvedBase + path.sep)
    ) {
      throw new Error('Unsafe temporary media path.');
    }

    await Promise.all([
      streamUrlToLocalFile({ url: videoStreamUrl, targetPath: tempVideo, userAgent, cookieHeader }),
      streamUrlToLocalFile({ url: audioStreamUrl, targetPath: tempAudio, userAgent, cookieHeader }),
    ]);

    // Lossless remux into Matroska supports all highest-quality YouTube codecs (AV1/VP9/H.264 + Opus/AAC)
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        tempVideo,
        '-i',
        tempAudio,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c',
        'copy',
        '-shortest',
        outputPath,
      ],
      { timeout: 120_000 }
    );
  }

  const stat = await fs.stat(outputPath);
  if (stat.size < 10_000) {
    throw new Error('Downloaded YouTube video file was empty or truncated.');
  }

  return outputPath;
}
