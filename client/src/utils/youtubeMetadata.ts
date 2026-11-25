export const YOUTUBE_TITLE_MAX_CHARS = 100;
export const YOUTUBE_DESCRIPTION_MAX_CHARS = 5000;

export const TITLE_SUGGESTED_HASHTAGS: readonly string[] = [
  '#Shorts',
  '#Viral',
  '#Trending',
  '#YouTubeShorts',
  '#FYP',
  '#MustWatch',
];

export const VIRAL_DESCRIPTION_HASHTAGS: readonly string[] = [
  '#Shorts',
  '#Viral',
  '#Trending',
  '#YouTubeShorts',
  '#ViralShorts',
  '#FYP',
  '#MustWatch',
  '#TrendingNow',
  '#Explore',
  '#ShortVideo',
  '#ViralVideo',
  '#Reels',
];

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'about', 'have', 'what', 'when',
  'where', 'which', 'while', 'will', 'would', 'could', 'should', 'into', 'over', 'after', 'before',
  'here', 'there', 'their', 'they', 'them', 'then', 'than', 'just', 'like', 'more', 'most', 'only',
  'very', 'some', 'such', 'make', 'made', 'does', 'dont', 'cant', 'wont', 'been', 'being', 'every',
  'clip', 'video', 'watch', 'part', 'guys', 'back', 'really', 'actually', 'literally', 'because',
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hasHashtag(text: string, tag: string): boolean {
  const clean = tag.replace(/^#/, '').toLowerCase();
  if (!clean) return false;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)#${escaped}\\b`, 'i').test(text);
}

/**
 * Extracts up to 4 clean topic hashtags from the clip's title/caption so YouTube descriptions
 * combine clip-specific keywords with trending Shorts hashtags.
 */
export function extractTopicHashtags(title: string, caption: string, maxCount = 4): string[] {
  const combined = `${title} ${caption}`;
  const found: string[] = [];
  const seen = new Set<string>();

  // Preserve any existing custom hashtags from the caption first
  const existingMatches = combined.match(/#[A-Za-z][A-Za-z0-9_]{2,24}/g) ?? [];
  for (const raw of existingMatches) {
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(raw);
    }
    if (found.length >= maxCount) return found;
  }

  // Derive additional topic hashtags from prominent words in the title
  const words = title
    .replace(/#[A-Za-z0-9_]+/g, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w));

  for (const word of words) {
    const lower = word.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    const tag = `#${word.charAt(0).toUpperCase()}${lower.slice(1)}`;
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(tag);
    }
    if (found.length >= maxCount) break;
  }

  return found;
}

/**
 * Builds a YouTube-ready Shorts title strictly within 100 characters that includes
 * viral Shorts hashtags (#Shorts #Viral) right in the title.
 */
export function buildDefaultYouTubeTitle(rawTitle: string): string {
  const base = normalizeWhitespace(rawTitle) || 'Viral Highlight Clip';
  const suffixTags: string[] = [];
  if (!hasHashtag(base, '#Shorts')) suffixTags.push('#Shorts');
  if (!hasHashtag(base, '#Viral')) suffixTags.push('#Viral');

  if (suffixTags.length === 0) {
    return base.slice(0, YOUTUBE_TITLE_MAX_CHARS).trim();
  }

  const suffix = ` ${suffixTags.join(' ')}`;
  if (base.length + suffix.length <= YOUTUBE_TITLE_MAX_CHARS) {
    return `${base}${suffix}`;
  }

  // Trim the base text at a clean word boundary so the hashtags always fit within 100 chars
  const maxBaseLen = YOUTUBE_TITLE_MAX_CHARS - suffix.length;
  let trimmed = base.slice(0, maxBaseLen).trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxBaseLen * 0.55)) {
    trimmed = trimmed.slice(0, lastSpace).trim();
  }
  trimmed = trimmed.replace(/[,:;\-–—|]+$/, '').trim();

  return `${trimmed}${suffix}`.slice(0, YOUTUBE_TITLE_MAX_CHARS).trim();
}

/**
 * Builds a YouTube-ready Shorts description (up to 5000 characters) pre-populated
 * with the clip summary, engagement CTA, topic hashtags, and high-reach viral hashtags.
 */
export function buildDefaultYouTubeDescription(rawTitle: string, rawCaption: string): string {
  const cleanTitle = normalizeWhitespace(rawTitle);
  const cleanCaption = rawCaption.trim();

  // Strip trailing inline hashtags from the caption body so we can format a clean viral hashtag block
  const captionBody = cleanCaption
    .replace(/(?:\s+#[A-Za-z0-9_]+)+\s*$/g, '')
    .trim();

  const topicTags = extractTopicHashtags(cleanTitle, cleanCaption, 4);
  const allTags: string[] = [];
  const seen = new Set<string>();

  for (const tag of [...VIRAL_DESCRIPTION_HASHTAGS, ...topicTags]) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      allTags.push(tag);
    }
  }

  const blocks: string[] = [];
  if (captionBody) {
    blocks.push(captionBody);
  } else if (cleanTitle) {
    blocks.push(cleanTitle);
  }
  blocks.push('Watch till the end and subscribe for more viral Shorts!');
  blocks.push(allTags.join(' '));

  return blocks.join('\n\n').slice(0, YOUTUBE_DESCRIPTION_MAX_CHARS);
}

/**
 * Safely appends a hashtag to a title or description without duplicating it
 * or exceeding the platform's character limit.
 */
export function appendHashtagSafely(
  currentText: string,
  hashtag: string,
  maxChars: number,
  separator: ' ' | '\n' = ' '
): string {
  const normalizedTag = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
  if (hasHashtag(currentText, normalizedTag)) {
    return currentText;
  }

  const trimmed = currentText.trimEnd();
  if (!trimmed) {
    return normalizedTag.slice(0, maxChars);
  }

  const joiner = separator === '\n' && !trimmed.includes('#') ? '\n\n' : ' ';
  const candidate = `${trimmed}${joiner}${normalizedTag}`;
  if (candidate.length <= maxChars) {
    return candidate;
  }

  return currentText;
}

/**
 * Appends any missing viral hashtags from VIRAL_DESCRIPTION_HASHTAGS into the description
 * without exceeding the 5000-character YouTube limit.
 */
export function appendViralHashtagsPack(
  currentDescription: string,
  extraTags: readonly string[] = []
): string {
  let next = currentDescription;
  for (const tag of [...VIRAL_DESCRIPTION_HASHTAGS, ...extraTags]) {
    next = appendHashtagSafely(next, tag, YOUTUBE_DESCRIPTION_MAX_CHARS, '\n');
  }
  return next;
}
