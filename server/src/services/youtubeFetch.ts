import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
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
  };
}

export function extractBestStreams(streamingData?: InnertubePlayerData['streamingData']): {
  videoUrl: string | null;
  audioUrl: string | null;
} {
  if (!streamingData) return { videoUrl: null, audioUrl: null };

  // 1. Always inspect adaptiveFormats first to capture highest resolution (4K/1440p/1080p60) + highest bitrate audio
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

  const bestAdaptiveVideo = adaptiveVideos[0];
  const bestAdaptiveAudio = adaptiveAudios[0];
  const bestMuxed = muxedStreams[0];

  // Use adaptive highest-quality stream whenever available and at least as sharp as muxed
  if (
    bestAdaptiveVideo?.url &&
    bestAdaptiveAudio?.url &&
    (bestAdaptiveVideo.height ?? 0) >= (bestMuxed?.height ?? 0)
  ) {
    return { videoUrl: bestAdaptiveVideo.url, audioUrl: bestAdaptiveAudio.url };
  }

  if (bestMuxed?.url) {
    return { videoUrl: bestMuxed.url, audioUrl: null };
  }

  return { videoUrl: null, audioUrl: null };
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
  endpoint?: 'googleapis' | 'youtube';
  useAuthCookies?: boolean;
  skipVisitorData?: boolean;
  client: Record<string, unknown>;
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

  const resp = await fetch(params.url, {
    method: 'POST',
    headers: params.headers,
    body: params.body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as Record<string, unknown>;
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
  let transcript: TranscriptSegment[] = [];
  let botCheckBlocked = webPlayability.status === 'LOGIN_REQUIRED';

  // If authenticated watch page itself already contains direct streamingData, grab it
  if (webPlayability.status === 'OK' && webPlayer?.streamingData) {
    const extracted = extractBestStreams(webPlayer.streamingData);
    if (extracted.videoUrl) {
      streamUrl = extracted.videoUrl;
      audioStreamUrl = extracted.audioUrl;
      streamUserAgent = WEB_UA;
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

  const proxyUrl = getConfiguredProxy();

  clientQueue.push(
    {
      name: 'ANDROID',
      ua: ANDROID_INNERTUBE_UA,
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
      name: 'ANDROID_VR',
      ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      endpoint: 'googleapis',
      skipVisitorData: true,
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.62.27',
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
      name: 'TVHTML5',
      ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
      endpoint: 'youtube',
      client: {
        clientName: 'TVHTML5',
        clientVersion: '7.20250312.16.00',
        hl: 'en',
        gl: 'US',
      },
    }
  );

  if (!streamUrl) {
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
          const extracted = extractBestStreams(data.streamingData);
          if (extracted.videoUrl) {
            streamUrl = extracted.videoUrl;
            audioStreamUrl = extracted.audioUrl;
            streamUserAgent = spec.ua;
            botCheckBlocked = false;
          }

          if (transcript.length === 0) {
            const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
            if (tracks.length > 0) {
              transcript = await fetchBestCaptionTrack(tracks, authCookies?.cookieHeader);
            }
          }

          if (streamUrl) {
            logger.info('Resolved direct YouTube video stream', {
              videoId,
              client: spec.name,
              adaptiveMux: Boolean(audioStreamUrl),
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
      ...(params.cookieHeader ? ['-H', `Cookie: ${params.cookieHeader}`] : []),
      '-o',
      params.targetPath,
      '--',
      params.url,
    ];
    await execFileAsync('curl', args, { timeout: 5 * 60_000 });
    return;
  }

  const response = await fetch(params.url, {
    headers: {
      'User-Agent': params.userAgent,
      ...(params.cookieHeader ? { Cookie: params.cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(5 * 60_000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`YouTube media download failed with HTTP ${response.status}`);
  }

  const webStream = response.body as unknown as Parameters<typeof Readable.fromWeb>[0];
  await pipeline(Readable.fromWeb(webStream), createWriteStream(params.targetPath));
}

/**
 * Downloads the resolved HTTPS googlevideo.com stream(s) into jobDir/source.mp4 once on the server
 * via native HTTP streaming so ffmpeg can cut all 1–5 vertical clips fast from local disk.
 */
export async function downloadYouTubeStreamsToFile(params: {
  videoStreamUrl: string;
  audioStreamUrl?: string | null;
  userAgent: string;
  cookieHeader?: string;
  jobDir: string;
}): Promise<string> {
  const { videoStreamUrl, audioStreamUrl, userAgent, cookieHeader, jobDir } = params;

  if (!isTrustedGoogleVideoStreamUrl(videoStreamUrl)) {
    throw new Error('Refused untrusted video stream URL.');
  }
  if (audioStreamUrl && !isTrustedGoogleVideoStreamUrl(audioStreamUrl)) {
    throw new Error('Refused untrusted audio stream URL.');
  }

  const resolvedBase = path.resolve(jobDir);
  const outputPath = path.resolve(resolvedBase, audioStreamUrl ? 'source.mkv' : 'source.mp4');
  if (!outputPath.startsWith(resolvedBase + path.sep)) {
    throw new Error('Unsafe source video output path.');
  }

  if (!audioStreamUrl) {
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
