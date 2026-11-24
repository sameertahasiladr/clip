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
