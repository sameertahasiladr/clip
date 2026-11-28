const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

export interface YouTubeValidationResult {
  valid: boolean;
  videoId?: string;
  canonicalUrl?: string;
  error?: string;
}

/**
 * Validates public YouTube URLs across youtube.com/watch, youtu.be, youtube.com/shorts,
 * youtube.com/live, youtube.com/embed, and music.youtube.com.
 * Rejects non-HTTP(S) schemes, unsupported hosts, and malformed video IDs.
 */
export function validateYouTubeUrl(rawInput: string): YouTubeValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Paste a YouTube link to get started.',
    };
  }

  let parsed: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProtocol);
  } catch {
    return {
      valid: false,
      error: 'Enter a valid URL from youtube.com/watch, youtu.be, or youtube.com/shorts.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      error: 'Only http:// and https:// YouTube links are supported.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return {
      valid: false,
      error: 'Unsupported link. Use a youtube.com/watch, youtu.be, or youtube.com/shorts URL.',
    };
  }

  let videoId: string | null = null;
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = segments[0] ?? null;
  } else if (segments[0] === 'watch') {
    videoId = parsed.searchParams.get('v');
  } else if (segments[0] === 'shorts' || segments[0] === 'live' || segments[0] === 'embed') {
    videoId = segments[1] ?? null;
  } else {
    return {
      valid: false,
      error: 'Use a direct video link (youtube.com/watch?v=..., youtu.be/..., or youtube.com/shorts/...).',
    };
  }

  if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return {
      valid: false,
      error: 'Could not find a valid 11-character YouTube video ID in that link.',
    };
  }

  return {
    valid: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats seconds as MM:SS (or H:MM:SS when >= 1 hour) for timestamp inputs and timeline labels.
 */
export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parses flexible user timestamp inputs ("90", "1:30", "01:30", "1:02:05", or "12.5")
 * into non-negative seconds, or returns null for malformed values.
 */
export function parseTimestampInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const val = Number.parseFloat(trimmed);
    return Number.isFinite(val) && val >= 0 ? Number(val.toFixed(2)) : null;
  }

  const parts = trimmed.split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[0]) || !/^\d{1,2}(?:\.\d+)?$/.test(parts[1])) {
      return null;
    }
    const mins = Number.parseInt(parts[0], 10);
    const secs = Number.parseFloat(parts[1]);
    if (!Number.isFinite(secs) || secs < 0 || secs >= 60) return null;
    return Number((mins * 60 + secs).toFixed(2));
  }

  if (
    !/^\d+$/.test(parts[0]) ||
    !/^\d{1,2}$/.test(parts[1]) ||
    !/^\d{1,2}(?:\.\d+)?$/.test(parts[2])
  ) {
    return null;
  }
  const hours = Number.parseInt(parts[0], 10);
  const mins = Number.parseInt(parts[1], 10);
  const secs = Number.parseFloat(parts[2]);
  if (mins >= 60 || !Number.isFinite(secs) || secs < 0 || secs >= 60) return null;
  return Number((hours * 3600 + mins * 60 + secs).toFixed(2));
}

export function getViralityLabel(score: number): {
  label: string;
  toneClass: string;
} {
  if (score >= 90) {
    return { label: 'High Hook', toneClass: 'text-fuchsia-300' };
  }
  if (score >= 80) {
    return { label: 'Strong', toneClass: 'text-purple-300' };
  }
  return { label: 'Solid', toneClass: 'text-zinc-300' };
}

export function sanitizeFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'clipgenie-short';
}
