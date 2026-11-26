import { z } from 'zod';
import type { ClipLength, CreateJobInput, MomentSelection } from './types.js';

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/**
 * Parses and canonicalizes a public YouTube URL to https://www.youtube.com/watch?v=<id>.
 * Strictly blocks non-YouTube domains, loopback/internal hosts, and non-HTTP(S) schemes.
 */
export function parseCanonicalYouTubeUrl(rawUrl: string): {
  valid: boolean;
  videoId?: string;
  canonicalUrl?: string;
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'YouTube URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'Only http and https URLs are allowed.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return {
      valid: false,
      error: 'URL must be from youtube.com/watch, youtu.be, or youtube.com/shorts.',
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  let videoId: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = segments[0] ?? null;
  } else if (segments[0] === 'watch') {
    videoId = parsed.searchParams.get('v');
  } else if (segments[0] === 'shorts' || segments[0] === 'live' || segments[0] === 'embed') {
    videoId = segments[1] ?? null;
  } else {
    return {
      valid: false,
      error: 'Unsupported YouTube path. Use /watch, /shorts, /live, /embed, or youtu.be/<id>.',
    };
  }

  if (!videoId || !YOUTUBE_ID_REGEX.test(videoId)) {
    return { valid: false, error: 'Invalid YouTube video ID.' };
  }

  return {
    valid: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export const MAX_CLIP_COUNT = 20;

export const createJobBodySchema = z.object({
  url: z.string().min(1, 'URL is required').max(500, 'URL is too long'),
  clipLength: z.union([z.literal(15), z.literal(30)]).default(30),
  clipCount: z.number().int().min(1).max(MAX_CLIP_COUNT).default(3),
  captions: z.boolean().default(true),
  videoLayout: z.enum(['vertical-fill', 'vertical-blur']).default('vertical-fill'),
  audioMode: z.enum(['original', 'mute']).default('original'),
});

export function validateCreateJobRequest(body: unknown): {
  success: true;
  data: CreateJobInput;
  videoId: string;
} | {
  success: false;
  error: string;
} {
  const parsed = createJobBodySchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      success: false,
      error: firstIssue ? `${firstIssue.path.join('.') || 'body'}: ${firstIssue.message}` : 'Invalid request payload.',
    };
  }

  const urlCheck = parseCanonicalYouTubeUrl(parsed.data.url);
  if (!urlCheck.valid || !urlCheck.canonicalUrl || !urlCheck.videoId) {
    return {
      success: false,
      error: urlCheck.error ?? 'Invalid YouTube URL.',
    };
  }

  return {
    success: true,
    videoId: urlCheck.videoId,
    data: {
      url: urlCheck.canonicalUrl,
      clipLength: parsed.data.clipLength,
      clipCount: parsed.data.clipCount,
      captions: parsed.data.captions,
      videoLayout: parsed.data.videoLayout,
      audioMode: parsed.data.audioMode,
    },
  };
}

export function isValidJobId(jobId: string): boolean {
  return UUID_REGEX.test(jobId);
}

const momentItemSchema = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  title: z.string().trim().min(1).max(120),
  caption: z.string().trim().min(1).max(500),
  score: z.number().finite().min(0).max(100),
});

export function sanitizeDownloadSlug(raw: string | undefined): string {
  const slug = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'clipgenie-short';
}

/**
 * Validates and normalizes AI-selected moments:
 * - clamps moments slightly outside clipLength +/- 2s to exact clipLength when valid
 * - enforces start < end <= videoDuration
 * - eliminates overlapping ranges while preserving top-scored moments
 */
export function validateSelectedMoments(
  rawMoments: unknown,
  clipLength: ClipLength,
  maxClips: number,
  videoDuration: number
): MomentSelection[] {
  const arrayResult = z.array(momentItemSchema).safeParse(rawMoments);
  if (!arrayResult.success) {
    throw new Error('AI returned malformed moments JSON.');
  }

  const minLen = clipLength - 2;
  const maxLen = clipLength + 2;

  const validCandidates = arrayResult.data
    .map((m) => {
      const start = Math.max(0, Math.min(videoDuration - minLen, Number(m.start.toFixed(2))));
      let end = Math.min(videoDuration, Number(m.end.toFixed(2)));
      const rawLen = end - start;

      // If AI was slightly off target (e.g. 10-45s), snap cleanly to target clipLength instead of dropping the moment
      if (rawLen >= 8 && rawLen < minLen) {
        end = Math.min(videoDuration, Number((start + clipLength).toFixed(2)));
      } else if (rawLen > maxLen && rawLen <= clipLength + 20) {
        end = Math.min(videoDuration, Number((start + clipLength).toFixed(2)));
      }

      return {
        ...m,
        start,
        end,
        score: Math.round(Math.min(100, Math.max(0, m.score))),
      };
    })
    .filter((m) => {
      const len = m.end - m.start;
      return m.end > m.start && len >= minLen && len <= maxLen;
    })
    .sort((a, b) => b.score - a.score);

  const nonOverlapping: MomentSelection[] = [];
  for (const candidate of validCandidates) {
    const overlaps = nonOverlapping.some(
      (existing) => candidate.start < existing.end && candidate.end > existing.start
    );
    if (!overlaps) {
      nonOverlapping.push(candidate);
    }
    if (nonOverlapping.length >= maxClips) {
      break;
    }
  }

  if (nonOverlapping.length === 0) {
    throw new Error(
      `No valid non-overlapping ${clipLength}s (+/-2s) moments were returned for this video.`
    );
  }

  return nonOverlapping;
}
