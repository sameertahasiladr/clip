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

export const DEFAULT_DESCRIPTION_CAPTION =
  '#morningpost #viralvideos #trending #viralposts #viralchallenge #hottrending #viralnow #trendingpost #instatrending #reels #bhojpuri #kpop #sad #funny #motivation #viral #bgmi #anime #kitten #funny #art #viralshorts #humor #viral #love #dance #jokes #quotes #wedding #edit #trending #reels #trendingshorts #youtubeshorts #usa #india #omletarcade #pubgmobile #art #shortvideo #dance #funny #fyp #gaming #humor #jokes #knowledge #love #live #zodiac #xbox #comedy #cute #viralshort #bgmi #news #motivation';

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

interface NicheHashtagRule {
  label: string;
  keywords: readonly string[];
  hashtags: readonly string[];
}

const CONTEXT_NICHE_RULES: readonly NicheHashtagRule[] = [
  {
    label: 'Creator & Growth',
    keywords: [
      'youtube', 'shorts', 'hook', 'hooks', 'retention', 'views', 'subscriber', 'subscribers',
      'algorithm', 'creator', 'creators', 'thumbnail', 'editing', 'camera', 'lighting',
      'filmmaking', 'rpm', 'content', 'channel', 'reels', 'tiktok',
    ],
    hashtags: ['#CreatorTips', '#ContentCreator', '#YouTubeGrowth', '#ViralHooks', '#VideoEditing'],
  },
  {
    label: 'Business & Finance',
    keywords: [
      'startup', 'startups', 'founder', 'founders', 'business', 'money', 'pricing', 'margin',
      'revenue', 'sales', 'marketing', 'invest', 'investing', 'stock', 'stocks', 'crypto',
      'wealth', 'millionaire', 'income', 'profit', 'client', 'clients', 'entrepreneur',
    ],
    hashtags: ['#Entrepreneur', '#BusinessTips', '#StartupLife', '#MoneyMindset', '#FinanceShorts'],
  },
  {
    label: 'AI & Tech',
    keywords: [
      'ai', 'chatgpt', 'gemini', 'claude', 'openai', 'coding', 'code', 'programming', 'developer',
      'software', 'tech', 'technology', 'app', 'iphone', 'android', 'laptop', 'gadget', 'robot',
      'engineering', 'python', 'javascript', 'automation',
    ],
    hashtags: ['#TechShorts', '#AI', '#TechTrends', '#FutureTech', '#Coding'],
  },
  {
    label: 'Motivation & Mindset',
    keywords: [
      'mindset', 'discipline', 'habit', 'habits', 'success', 'focus', 'grind', 'hustle',
      'motivation', 'inspire', 'life', 'lesson', 'lessons', 'advice', 'mistake', 'mistakes',
      'growth', 'productivity', 'goals', 'confidence', 'psychology',
    ],
    hashtags: ['#Motivation', '#SuccessMindset', '#DailyMotivation', '#SelfImprovement', '#Mindset'],
  },
  {
    label: 'Podcast & Interviews',
    keywords: [
      'podcast', 'interview', 'guest', 'host', 'story', 'stories', 'asked', 'conversation',
      'debate', 'truth', 'secret', 'secrets', 'unpopular', 'opinion',
    ],
    hashtags: ['#PodcastClips', '#PodcastShorts', '#Interview', '#DeepTalk', '#RealTalk'],
  },
  {
    label: 'Fitness & Health',
    keywords: [
      'gym', 'workout', 'fitness', 'muscle', 'protein', 'diet', 'weight', 'fat', 'cardio',
      'health', 'sleep', 'training', 'exercise', 'strength', 'running', 'bodybuilding',
    ],
    hashtags: ['#FitnessShorts', '#WorkoutTips', '#GymMotivation', '#HealthyLifestyle', '#FitTok'],
  },
  {
    label: 'Gaming & Esports',
    keywords: [
      'game', 'gaming', 'gamer', 'gameplay', 'minecraft', 'fortnite', 'valorant', 'gta',
      'esports', 'clutch', 'stream', 'streamer', 'boss', 'speedrun', 'console', 'ps5',
    ],
    hashtags: ['#GamingShorts', '#Gamer', '#Gameplay', '#GamingClips', '#Esports'],
  },
  {
    label: 'Food & Cooking',
    keywords: [
      'recipe', 'cook', 'cooking', 'chef', 'food', 'kitchen', 'delicious', 'taste', 'eat',
      'eating', 'restaurant', 'streetfood', 'meal', 'dinner', 'breakfast', 'baking',
    ],
    hashtags: ['#FoodShorts', '#CookingTips', '#EasyRecipe', '#Foodie', '#QuickRecipes'],
  },
  {
    label: 'Comedy & Entertainment',
    keywords: [
      'funny', 'comedy', 'joke', 'laugh', 'prank', 'meme', 'memes', 'reaction', 'react',
      'crazy', 'insane', 'wild', 'hilarious', 'skit', 'roast', 'epic',
    ],
    hashtags: ['#ComedyShorts', '#FunnyVideos', '#Relatable', '#Entertainment', '#LaughOutLoud'],
  },
  {
    label: 'Education & Science',
    keywords: [
      'science', 'physics', 'space', 'history', 'fact', 'facts', 'learn', 'explained',
      'tutorial', 'how', 'study', 'brain', 'universe', 'experiment', 'math', 'discovery',
    ],
    hashtags: ['#DidYouKnow', '#LearnOnYouTube', '#MindBlown', '#FunFacts', '#EduShorts'],
  },
  {
    label: 'Travel & Lifestyle',
    keywords: [
      'travel', 'trip', 'vacation', 'flight', 'hotel', 'country', 'city', 'explore',
      'adventure', 'vlog', 'lifestyle', 'morning', 'routine', 'aesthetic', 'beach', 'mountain',
    ],
    hashtags: ['#TravelShorts', '#Wanderlust', '#DailyVlog', '#Lifestyle', '#ExploreMore'],
  },
  {
    label: 'Music & Audio',
    keywords: [
      'music', 'song', 'beat', 'beats', 'guitar', 'piano', 'singer', 'vocals', 'lyrics',
      'concert', 'rap', 'hiphop', 'melody', 'remix', 'producer', 'album',
    ],
    hashtags: ['#MusicShorts', '#NewMusic', '#MusicProducer', '#LiveMusic', '#ViralSound'],
  },
];

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'about', 'have', 'what', 'when',
  'where', 'which', 'while', 'will', 'would', 'could', 'should', 'into', 'over', 'after', 'before',
  'here', 'there', 'their', 'they', 'them', 'then', 'than', 'just', 'like', 'more', 'most', 'only',
  'very', 'some', 'such', 'make', 'made', 'does', 'dont', 'cant', 'wont', 'been', 'being', 'every',
  'clip', 'video', 'watch', 'part', 'guys', 'back', 'really', 'actually', 'literally', 'because',
  'first', 'second', 'seconds', 'thing', 'things', 'people', 'never', 'always', 'still', 'right',
]);

export interface VideoHashtagContext {
  title: string;
  caption?: string;
  transcriptCues?: ReadonlyArray<{ text: string }>;
  maxTitleTags?: number;
  maxDescriptionTags?: number;
}

export interface ViralHashtagSuggestions {
  detectedNiche: string | null;
  titleHashtags: string[];
  nicheHashtags: string[];
  topicHashtags: string[];
  viralHashtags: string[];
  allDescriptionHashtags: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hasHashtag(text: string, tag: string): boolean {
  const clean = tag.replace(/^#/, '').toLowerCase();
  if (!clean) return false;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)#${escaped}\\b`, 'i').test(text);
}

function dedupeHashtags(tags: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const clean = raw.startsWith('#') ? raw : `#${raw}`;
    if (!/^#[A-Za-z][A-Za-z0-9_]{1,28}$/.test(clean)) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

/**
 * Extracts clean topic hashtags from the clip's title, caption, and spoken transcript cues
 * so YouTube metadata combines clip-specific keywords with trending Shorts hashtags.
 */
export function extractTopicHashtags(
  title: string,
  caption: string,
  maxCount = 4,
  transcriptCues?: ReadonlyArray<{ text: string }>
): string[] {
  const transcriptText = (transcriptCues ?? []).map((c) => c.text).join(' ');
  const combined = `${title} ${caption} ${transcriptText}`;
  const found: string[] = [];
  const seen = new Set<string>();

  // Preserve any existing custom hashtags from title/caption first
  const existingMatches = `${title} ${caption}`.match(/#[A-Za-z][A-Za-z0-9_]{2,24}/g) ?? [];
  for (const raw of existingMatches) {
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(raw);
    }
    if (found.length >= maxCount) return found;
  }

  // Score candidate context words (title words weighted 3x, caption/transcript 1x)
  const wordScores = new Map<string, { score: number; sample: string }>();
  const addWords = (source: string, weight: number) => {
    const tokens = source
      .replace(/#[A-Za-z0-9_]+/g, ' ')
      .replace(/[^A-Za-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w));

    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (STOP_WORDS.has(lower)) continue;
      const prev = wordScores.get(lower);
      if (prev) {
        prev.score += weight;
      } else {
        wordScores.set(lower, { score: weight, sample: token });
      }
    }
  };

  addWords(title, 3);
  addWords(caption, 2);
  if (transcriptText) addWords(transcriptText, 1);

  const ranked = Array.from(wordScores.entries())
    .sort((a, b) => b[1].score - a[1].score || b[0].length - a[0].length)
    .map(([lower]) => `#${lower.charAt(0).toUpperCase()}${lower.slice(1)}`);

  for (const tag of ranked) {
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
 * Analyzes video context (title, caption, and spoken transcript cues) and suggests
 * trending, niche-matched, and viral Shorts hashtags for injection into the metadata editor.
 */
export function suggestViralHashtags(context: VideoHashtagContext): ViralHashtagSuggestions {
  const title = context.title ?? '';
  const caption = context.caption ?? '';
  const transcriptText = (context.transcriptCues ?? []).map((c) => c.text).join(' ');
  const combinedLower = `${title} ${title} ${caption} ${transcriptText}`.toLowerCase();
  const tokenSet = new Set(combinedLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));

  const nicheMatches: Array<{ rule: NicheHashtagRule; score: number }> = [];
  for (const rule of CONTEXT_NICHE_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (tokenSet.has(kw)) {
        score += title.toLowerCase().includes(kw) ? 3 : 1;
      }
    }
    if (score > 0) {
      nicheMatches.push({ rule, score });
    }
  }
  nicheMatches.sort((a, b) => b.score - a.score);

  const primaryNiche = nicheMatches[0]?.rule ?? null;
  const secondaryNiche = nicheMatches[1]?.rule ?? null;

  const nicheHashtags = dedupeHashtags([
    ...(primaryNiche?.hashtags ?? []),
    ...(secondaryNiche ? secondaryNiche.hashtags.slice(0, 2) : []),
  ]);

  const topicHashtags = extractTopicHashtags(title, caption, 4, context.transcriptCues);
  const viralHashtags = [...VIRAL_DESCRIPTION_HASHTAGS];

  const maxTitleTags = context.maxTitleTags ?? 8;
  const titleHashtags = dedupeHashtags([
    '#Shorts',
    '#Viral',
    '#Trending',
    ...(nicheHashtags.slice(0, 2)),
    ...(topicHashtags.slice(0, 2)),
    '#YouTubeShorts',
    '#FYP',
    '#MustWatch',
  ]).slice(0, maxTitleTags);

  const maxDescTags = context.maxDescriptionTags ?? 18;
  const allDescriptionHashtags = dedupeHashtags([
    '#Shorts',
    '#Viral',
    '#Trending',
    '#YouTubeShorts',
    '#ViralShorts',
    ...nicheHashtags,
    ...topicHashtags,
    ...viralHashtags,
  ]).slice(0, maxDescTags);

  return {
    detectedNiche: primaryNiche?.label ?? null,
    titleHashtags,
    nicheHashtags,
    topicHashtags,
    viralHashtags,
    allDescriptionHashtags,
  };
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
 * Builds the default YouTube Shorts description (up to 5000 characters) pre-populated
 * with the configured viral hashtag caption, ready for editing or direct upload.
 */
export function buildDefaultYouTubeDescription(
  _rawTitle: string,
  _rawCaption: string,
  _transcriptCues?: ReadonlyArray<{ text: string }>
): string {
  return DEFAULT_DESCRIPTION_CAPTION.slice(0, YOUTUBE_DESCRIPTION_MAX_CHARS);
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
 * Appends any missing context-matched & viral hashtags into the description
 * without exceeding the 5000-character YouTube limit.
 */
export function appendViralHashtagsPack(
  currentDescription: string,
  extraTags: readonly string[] = []
): string {
  let next = currentDescription;
  for (const tag of dedupeHashtags([...extraTags, ...VIRAL_DESCRIPTION_HASHTAGS])) {
    next = appendHashtagSafely(next, tag, YOUTUBE_DESCRIPTION_MAX_CHARS, '\n');
  }
  return next;
}

export interface CopyrightEvaluationSource {
  title: string;
  channelName: string;
  channelId?: string;
  canonicalUrl: string;
  sourceLicense: 'youtube' | 'creativeCommon' | 'unknown';
  category?: string;
  hasLicensedMusicSignals: boolean;
  audioMode: 'original' | 'mute';
}

export interface YouTubeCopyrightAssessment {
  level: 'owned' | 'cc-by' | 'caution';
  badgeLabel: string;
  headline: string;
  summary: string;
  recommendedLicense: 'youtube' | 'creativeCommon';
  recommendedPrivacy: 'public' | 'unlisted';
  recommendations: string[];
}

/**
 * Formats a clean Original Creator & License Attribution block for YouTube descriptions.
 */
export function buildCreatorAttributionBlock(source: CopyrightEvaluationSource): string {
  const lines = [
    `Original video: "${source.title}" by ${source.channelName}`,
    `Source: ${source.canonicalUrl}`,
  ];
  if (source.sourceLicense === 'creativeCommon') {
    lines.push('License: Creative Commons Attribution (CC BY) — https://creativecommons.org/licenses/by/3.0/');
  }
  return lines.join('\n');
}

/**
 * Prepends creator attribution to the description without duplicating an existing source link
 * or exceeding YouTube's 5000-character description limit.
 */
export function appendAttributionSafely(
  currentDescription: string,
  source: CopyrightEvaluationSource
): string {
  const attribution = buildCreatorAttributionBlock(source);
  if (
    currentDescription.includes(source.canonicalUrl) ||
    currentDescription.toLowerCase().includes('original video:')
  ) {
    return currentDescription;
  }

  const trimmed = currentDescription.trim();
  if (!trimmed) {
    return attribution.slice(0, YOUTUBE_DESCRIPTION_MAX_CHARS);
  }

  const combined = `${attribution}\n\n${trimmed}`;
  if (combined.length <= YOUTUBE_DESCRIPTION_MAX_CHARS) {
    return combined;
  }

  // Keep attribution intact and trim trailing hashtags only if near the 5000-char ceiling
  const allowedTail = YOUTUBE_DESCRIPTION_MAX_CHARS - attribution.length - 2;
  if (allowedTail <= 0) {
    return attribution.slice(0, YOUTUBE_DESCRIPTION_MAX_CHARS);
  }
  return `${attribution}\n\n${trimmed.slice(0, allowedTail).trimEnd()}`;
}

/**
 * Evaluates YouTube copyright safety based on channel ownership match, source video license
 * (Creative Commons CC-BY vs Standard YouTube License), music-rights signals, and audio mode.
 */
export function evaluateYouTubeCopyrightStatus(
  source: CopyrightEvaluationSource,
  connectedChannelId?: string | null
): YouTubeCopyrightAssessment {
  const isOwnChannel = Boolean(
    connectedChannelId && source.channelId && connectedChannelId === source.channelId
  );

  if (isOwnChannel) {
    return {
      level: 'owned',
      badgeLabel: 'Your Connected Channel',
      headline: 'Source video matches your connected YouTube channel',
      summary: source.hasLicensedMusicSignals
        ? 'This video belongs to your channel, though music-rights signals were detected. Confirm your music licenses cover Shorts reuse.'
        : 'This clip comes from your own connected YouTube channel and is safe to publish under your rights.',
      recommendedLicense: source.sourceLicense === 'creativeCommon' ? 'creativeCommon' : 'youtube',
      recommendedPrivacy: 'public',
      recommendations: source.hasLicensedMusicSignals
        ? ['Double-check any third-party music licenses in YouTube Studio Checks after uploading.']
        : ['Ready to publish directly to your YouTube channel.'],
    };
  }

  if (source.sourceLicense === 'creativeCommon') {
    return {
      level: 'cc-by',
      badgeLabel: 'Creative Commons (CC-BY)',
      headline: `Creative Commons video by ${source.channelName}`,
      summary:
        'This source video is marked Creative Commons Attribution (CC-BY). Include creator credit in the description and verify there are no third-party music claims.',
      recommendedLicense: 'creativeCommon',
      recommendedPrivacy: 'unlisted',
      recommendations: [
        'Click "Insert Creator Credit" to add proper CC-BY attribution to your description.',
        'Upload as Unlisted first so YouTube Studio Checks finishes scanning before going public.',
      ],
    };
  }

  const recommendations: string[] = [
    'Only publish if you own the rights, have permission from the creator, or are making transformative fair-use content.',
    'Upload as Unlisted or Private first so YouTube Studio\'s Checks tab can scan for copyright claims before publishing.',
  ];

  if (source.hasLicensedMusicSignals && source.audioMode !== 'mute') {
    recommendations.unshift(
      'Music-rights signals were detected on the source video. To avoid music Content ID claims, regenerate with "Mute Audio (Shorts Library)" and add licensed Shorts music inside YouTube Studio.'
    );
  } else if (source.audioMode === 'mute') {
    recommendations.unshift(
      'Audio was muted cleanly. After uploading, add a licensed track from the YouTube Shorts Audio Library in YouTube Studio.'
    );
  }

  return {
    level: 'caution',
    badgeLabel: source.hasLicensedMusicSignals
      ? 'Standard License · Music Detected'
      : 'Standard YouTube License',
    headline: `Third-party video by ${source.channelName}`,
    summary: source.hasLicensedMusicSignals
      ? 'Standard YouTube License with licensed music signals detected. Uploading unmodified third-party footage or music may trigger a YouTube Content ID claim or copyright strike.'
      : 'This source video uses the Standard YouTube License. Confirm you have permission to reuse it and run YouTube Studio Copyright Checks before making it public.',
    recommendedLicense: 'youtube',
    recommendedPrivacy: 'unlisted',
    recommendations,
  };
}
