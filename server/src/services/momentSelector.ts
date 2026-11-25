import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { ClipLength, MomentSelection, TranscriptSegment } from '../types.js';
import { validateSelectedMoments } from '../validation.js';
import { findBestMomentsWithClaude } from './claude.js';
import type { YouTubeChapter } from './youtubeFetch.js';

const OPENING_HOOK_PHRASES = [
  'stop doing',
  'never do',
  'here is why',
  "here's why",
  'most people',
  'nobody talks about',
  'the secret',
  'the truth',
  'the biggest mistake',
  'what if',
  'did you know',
  'you need to',
  'do not',
  "don't",
  'listen closely',
  'the real reason',
  'changed my life',
  'wait until',
  'watch this',
  'unpopular opinion',
];

const HOOK_KEYWORDS = [
  'why',
  'how',
  'never',
  'secret',
  'mistake',
  'stop',
  'truth',
  'actually',
  'best',
  'worst',
  'biggest',
  'wait',
  'imagine',
  'problem',
  'crazy',
  'insane',
  'shocking',
  'realize',
  'important',
  'nobody',
  'everyone',
  'million',
  'billion',
  'rule',
  'hack',
  'warning',
  'fail',
  'proof',
];

const WEAK_FILLER_OPENERS = [
  'hey guys',
  'hi guys',
  "what's up guys",
  'what is up',
  'welcome back',
  'welcome to my',
  'welcome to the',
  'in this video',
  "today we're going to",
  'today i want to',
  "don't forget to subscribe",
  'like and subscribe',
  'hit the bell',
  'thanks for watching',
  'thank you for watching',
  'link in the description',
  'sponsored by',
  'before we get started',
  'check out the link',
  'subscribe to',
  'smash that like',
];

function stripStageCues(text: string): string {
  return text
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects whether a transcript contains predominantly non-English script (e.g., Hindi/Devanagari,
 * Arabic, Cyrillic, CJK, etc.) so we can translate it to English before burning captions.
 */
export function isLikelyNonEnglishTranscript(segments: TranscriptSegment[]): boolean {
  const sample = segments
    .slice(0, 30)
    .map((s) => stripStageCues(s.text))
    .join(' ')
    .trim();

  if (sample.length < 12) return false;

  const nonLatinLetters = (sample.match(/[^\u0000-\u024F\s\d\p{P}\p{S}]/gu) ?? []).length;
  const totalLetters = (sample.match(/\p{L}/gu) ?? []).length;
  if (totalLetters === 0) return false;

  return nonLatinLetters / totalLetters > 0.25;
}

/**
 * Translates non-English transcript segments into crisp English while preserving exact timestamps
 * using Claude or Gemini when configured. Returns English transcripts untouched.
 */
export async function ensureEnglishTranscript(
  segments: TranscriptSegment[]
): Promise<TranscriptSegment[]> {
  if (segments.length === 0 || !isLikelyNonEnglishTranscript(segments)) {
    return segments;
  }

  const subset = segments.slice(0, 240);
  const payload = subset.map((s, idx) => ({ i: idx, t: s.text }));

  const applyTranslations = (translated: unknown): TranscriptSegment[] | null => {
    if (!Array.isArray(translated)) return null;
    const byIndex = new Map<number, string>();
    for (const item of translated) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { i?: unknown }).i === 'number' &&
        typeof (item as { t?: unknown }).t === 'string'
      ) {
        const clean = (item as { t: string }).t.trim();
        if (clean) byIndex.set((item as { i: number }).i, clean);
      }
    }
    if (byIndex.size === 0) return null;
    return segments.map((seg, idx) => ({
      ...seg,
      text: byIndex.get(idx) ?? seg.text,
    }));
  };

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Translate every caption segment into natural, concise English for short-form video subtitles. Keep the exact same index "i". Input JSON:\n${JSON.stringify(payload)}`,
        config: {
          systemInstruction:
            'You are a subtitle translator. Return ONLY a JSON array of objects with keys "i" (integer) and "t" (natural English subtitle string).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                i: { type: Type.INTEGER },
                t: { type: Type.STRING },
              },
              required: ['i', 't'],
            },
          },
        },
      });
      const parsed = JSON.parse((response.text ?? '[]').trim()) as unknown;
      const merged = applyTranslations(parsed);
      if (merged) return merged;
    } catch (err) {
      logger.warn('Gemini transcript English translation failed', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  if (config.claudeApiKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.claudeApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.claudeModel,
          max_tokens: 4096,
          temperature: 0.1,
          system:
            'Translate subtitle segments into natural, concise English. Return STRICT JSON ONLY: an array of {"i": number, "t": string} with no markdown.',
          messages: [{ role: 'user', content: JSON.stringify(payload) }],
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        const raw = data.content?.find((b) => b.type === 'text')?.text ?? '';
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start !== -1 && end > start) {
          const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
          const merged = applyTranslations(parsed);
          if (merged) return merged;
        }
      }
    } catch (err) {
      logger.warn('Claude transcript English translation failed', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return segments;
}

function buildHashtags(videoTitle: string, author: string): string {
  const words = `${videoTitle} ${author}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !['official', 'video', 'youtube', 'remaster', 'shorts', 'with', 'from', 'this', 'that'].includes(w)
    );

  const unique = Array.from(new Set(words)).slice(0, 2);
  const tags = ['#shorts', '#viral', ...unique.map((w) => `#${w}`)].slice(0, 3);
  return tags.join(' ');
}

function cleanSnippetTitle(rawText: string, fallbackTitle: string, clipIndex: number): string {
  const cleaned = stripStageCues(rawText);

  if (cleaned.length >= 10) {
    const firstSentence = cleaned.split(/[.!?]/)[0]?.trim() || cleaned;
    const words = firstSentence.split(/\s+/).slice(0, 10).join(' ');
    const capped = words.length > 64 ? `${words.slice(0, 61).trim()}...` : words;
    return capped.charAt(0).toUpperCase() + capped.slice(1);
  }

  const base = fallbackTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const shortBase = base.length > 48 ? `${base.slice(0, 45).trim()}...` : base;
  return `${shortBase} — Viral Hook ${clipIndex + 1}`;
}

/**
 * Scores a transcript window specifically for short-form viral hook strength:
 * heavily rewards scroll-stopping first-4-second hooks (curiosity gaps, contrarian takes,
 * numbers, questions) and strongly penalizes generic channel intros/outros/filler.
 */
export function scoreViralHookWindow(openingText: string, fullText: string): number {
  const openLower = stripStageCues(openingText).toLowerCase();
  const fullLower = stripStageCues(fullText).toLowerCase();
  const wordCount = fullLower ? fullLower.split(/\s+/).length : 0;

  let score = 68;

  // Heavy reward for high-retention viral opening phrases in the first ~4 seconds
  for (const phrase of OPENING_HOOK_PHRASES) {
    if (openLower.includes(phrase)) score += 9;
  }

  // Reward viral trigger words — weighted 2x higher when they appear right in the opening hook
  let hookKeywordBonus = 0;
  for (const kw of HOOK_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw}\\b`, 'i');
    if (pattern.test(openLower)) {
      hookKeywordBonus += 5;
    } else if (pattern.test(fullLower)) {
      hookKeywordBonus += 2;
    }
  }
  score += Math.min(20, hookKeywordBonus);

  // Questions, exclamations, and concrete numbers/percentages/money create strong curiosity gaps
  if (openingText.includes('?')) score += 8;
  else if (fullText.includes('?')) score += 4;

  if (openingText.includes('!')) score += 5;
  else if (fullText.includes('!')) score += 2;

  if (/\d+%|\$\d+|\b\d+\b/.test(openingText)) score += 7;
  else if (/\d+%|\$\d+|\b\d+\b/.test(fullText)) score += 3;

  // Ideal spoken density for a tight 15s-30s vertical short
  if (wordCount >= 22 && wordCount <= 95) score += 5;
  else if (wordCount < 8) score -= 10;

  // Heavy penalty for boring video intros, greetings, sponsor reads, and outros
  let hasWeakOpener = false;
  for (const filler of WEAK_FILLER_OPENERS) {
    if (openLower.includes(filler)) {
      score -= 26;
      hasWeakOpener = true;
      break;
    }
  }

  const ceiling = hasWeakOpener ? 68 : 98;
  return Math.min(ceiling, Math.max(45, Math.round(score)));
}

/**
 * Deterministic real-content viral hook selector built directly from the video's actual transcript,
 * chapters, and duration when neither CLAUDE_API_KEY nor GEMINI_API_KEY is configured.
 */
export function selectBestMomentsLocally(params: {
  transcript: TranscriptSegment[];
  chapters: YouTubeChapter[];
  clipLength: ClipLength;
  clipCount: number;
  videoDuration: number;
  videoTitle: string;
  author: string;
}): MomentSelection[] {
  const { transcript, chapters, clipLength, clipCount, videoDuration, videoTitle, author } = params;
  const hashtags = buildHashtags(videoTitle, author);

  // Handle very short videos (e.g. a 19s clip or YouTube Short) gracefully
  const effectiveClipLength = Math.min(clipLength, Math.max(5, Math.floor(videoDuration)));
  const maxPossibleClips = Math.max(
    1,
    Math.min(clipCount, Math.floor(videoDuration / effectiveClipLength) || 1)
  );

  // 1. Transcript-driven viral hook window scoring
  if (transcript.length >= 2 && videoDuration >= effectiveClipLength) {
    const candidates: MomentSelection[] = [];
    const minLen = Math.max(4, effectiveClipLength - 2);
    const maxLen = effectiveClipLength + 2;

    for (let i = 0; i < transcript.length; i++) {
      const firstSpoken = stripStageCues(transcript[i].text);
      // Do not start a clip on pure [Music] / [Applause] / empty silence cues
      if (firstSpoken.length < 3) continue;

      const windowStart = transcript[i].start;
      if (windowStart + minLen > videoDuration) break;

      let j = i;
      const parts: string[] = [];
      const openingParts: string[] = [];
      let windowEnd = transcript[i].end;

      while (j < transcript.length) {
        const seg = transcript[j];
        const nextEnd = Math.min(videoDuration, seg.end);
        if (nextEnd - windowStart > maxLen && parts.length > 0) {
          break;
        }
        parts.push(seg.text);
        if (openingParts.length === 0 || seg.start - windowStart <= 4.0) {
          openingParts.push(seg.text);
        }
        windowEnd = nextEnd;
        j += 1;
        if (windowEnd - windowStart >= minLen) {
          // Stop cleanly on sentence-ending punctuation when available
          if (/[.!?]$/.test(seg.text) || windowEnd - windowStart >= effectiveClipLength) {
            break;
          }
        }
      }

      // Snap end cleanly within clipLength +/- 2s if needed
      if (windowEnd - windowStart < minLen) {
        windowEnd = Math.min(videoDuration, windowStart + effectiveClipLength);
      } else if (windowEnd - windowStart > maxLen) {
        windowEnd = windowStart + effectiveClipLength;
      }

      const combinedText = stripStageCues(parts.join(' '));
      const openingText = stripStageCues(openingParts.join(' '));
      if (!combinedText) continue;

      const score = scoreViralHookWindow(openingText, combinedText);
      const quotePreview =
        combinedText.length > 155 ? `${combinedText.slice(0, 152).trim()}...` : combinedText;

      candidates.push({
        start: Number(windowStart.toFixed(2)),
        end: Number(windowEnd.toFixed(2)),
        title: cleanSnippetTitle(openingText || combinedText, videoTitle, candidates.length),
        caption: `"${quotePreview}" — ${author} ${hashtags}`,
        score,
      });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const picked: MomentSelection[] = [];
      for (const candidate of candidates) {
        const overlaps = picked.some(
          (existing) => candidate.start < existing.end && candidate.end > existing.start
        );
        if (!overlaps) {
          picked.push(candidate);
        }
        if (picked.length >= maxPossibleClips) break;
      }
      if (picked.length > 0) {
        return picked.sort((a, b) => b.score - a.score);
      }
    }
  }

  // 2. Chapter-driven highlights if the video includes description chapters (skip generic Intro chapter first)
  if (chapters.length > 0 && videoDuration >= effectiveClipLength) {
    const rankedChapters = [...chapters].sort((a, b) => {
      const aIntro = /^(intro|introduction|welcome|outro|sponsor)\b/i.test(a.title) ? 1 : 0;
      const bIntro = /^(intro|introduction|welcome|outro|sponsor)\b/i.test(b.title) ? 1 : 0;
      if (aIntro !== bIntro) return aIntro - bIntro;
      return scoreViralHookWindow(b.title, b.title) - scoreViralHookWindow(a.title, a.title);
    });

    const picked: MomentSelection[] = [];
    for (let i = 0; i < rankedChapters.length && picked.length < maxPossibleClips; i++) {
      const ch = rankedChapters[i];
      const start = Math.min(ch.start, Math.max(0, videoDuration - effectiveClipLength));
      const end = Math.min(videoDuration, start + effectiveClipLength);
      const overlaps = picked.some((existing) => start < existing.end && end > existing.start);
      if (overlaps || end <= start) continue;

      picked.push({
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        title: ch.title,
        caption: `${ch.title} — clipped from "${videoTitle}" by ${author}. ${hashtags}`,
        score: Math.max(82, 94 - picked.length * 3),
      });
    }
    if (picked.length > 0) {
      return picked;
    }
  }

  // 3. Evenly spaced non-overlapping highlights across the real video's duration (skipping intro fluff)
  const results: MomentSelection[] = [];
  const usableStart =
    videoDuration > effectiveClipLength * 2 ? Math.min(18, Math.floor(videoDuration * 0.1)) : 0;
  const usableSpan = Math.max(effectiveClipLength, videoDuration - usableStart);
  const stride =
    maxPossibleClips > 1
      ? Math.max(
          effectiveClipLength + 1,
          Math.floor((usableSpan - effectiveClipLength) / (maxPossibleClips - 1))
        )
      : effectiveClipLength;

  const baseTitle = videoTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const shortTitle = baseTitle.length > 48 ? `${baseTitle.slice(0, 45).trim()}...` : baseTitle;
  const labels = [
    'Viral Hook',
    'Peak Moment',
    'Key Takeaway',
    'Standout Highlight',
    'Closing Punchline',
  ];

  for (let i = 0; i < maxPossibleClips; i++) {
    const start = Math.min(
      Math.max(0, videoDuration - effectiveClipLength),
      usableStart + i * stride
    );
    const end = Math.min(videoDuration, start + effectiveClipLength);
    const overlaps = results.some((existing) => start < existing.end && end > existing.start);
    if (overlaps || end <= start) continue;

    const label = labels[i] ?? `Highlight ${i + 1}`;
    results.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      title: `${shortTitle} — ${label}`,
      caption: `${label} from "${videoTitle}" by ${author}. ${hashtags}`,
      score: Math.max(80, 93 - i * 3),
    });
  }

  return results;
}

async function findBestMomentsWithGemini(params: {
  transcript: TranscriptSegment[];
  clipLength: ClipLength;
  clipCount: number;
  videoDuration: number;
  videoTitle: string;
}): Promise<MomentSelection[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const transcriptText = params.transcript
    .slice(0, 400)
    .map((s) => `[${s.start.toFixed(2)} - ${s.end.toFixed(2)}] ${s.text}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      `Video title: "${params.videoTitle}"`,
      `Total duration: ${params.videoDuration.toFixed(2)} seconds.`,
      `Pick the ${params.clipCount} most viral moments for vertical 9:16 YouTube Shorts / Reels.`,
      'Viral Hook & Editing Rules:',
      `- Each moment MUST be ${params.clipLength} seconds (+/- 2s), start and end cleanly on sentence boundaries, and have zero overlaps.`,
      '- Every clip MUST start on a scroll-stopping viral hook in the first 3 seconds (bold claim, curiosity gap, sharp question, contrarian insight, surprising number, or emotional punchline).',
      '- NEVER start a clip on generic greetings, intros, sponsors, applause, or weak filler ("Hey guys", "Welcome back", "In this video", "Subscribe").',
      '- Write ALL "title" and "caption" fields strictly in natural, punchy English (even if the source video title or speech is in another language), with 2-3 relevant English hashtags in each caption.',
      '',
      'Timestamped transcript:',
      transcriptText,
    ].join('\n'),
    config: {
      systemInstruction:
        'You are an elite viral short-form video editor. Always write punchy English hook titles and English social captions. Return ONLY a JSON array of the best viral moments matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            start: { type: Type.NUMBER },
            end: { type: Type.NUMBER },
            title: { type: Type.STRING },
            caption: { type: Type.STRING },
            score: { type: Type.INTEGER },
          },
          required: ['start', 'end', 'title', 'caption', 'score'],
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim()) as unknown;
  return validateSelectedMoments(parsed, params.clipLength, params.clipCount, params.videoDuration);
}

/**
 * Tops up AI-selected moments with additional non-overlapping real moments from the video's
 * transcript, chapters, or timeline so selecting N clips (1-5) reliably returns N clips
 * whenever the source video is long enough to fit them without overlap.
 */
export function topUpMomentsToCount(params: {
  existing: MomentSelection[];
  transcript: TranscriptSegment[];
  chapters: YouTubeChapter[];
  clipLength: ClipLength;
  clipCount: number;
  videoDuration: number;
  videoTitle: string;
  author: string;
}): MomentSelection[] {
  const { existing, transcript, chapters, clipLength, clipCount, videoDuration, videoTitle, author } =
    params;

  const effectiveClipLength = Math.min(clipLength, Math.max(5, Math.floor(videoDuration)));
  const maxPossibleClips = Math.max(
    1,
    Math.min(clipCount, Math.floor(videoDuration / effectiveClipLength) || 1)
  );

  const selected: MomentSelection[] = [...existing].slice(0, maxPossibleClips);
  if (selected.length >= maxPossibleClips) {
    return selected.sort((a, b) => b.score - a.score);
  }

  const overlapsExisting = (start: number, end: number): boolean =>
    selected.some((item) => start < item.end && end > item.start);

  // Pull candidate pool from local real transcript / chapter hook scorer
  const fallbackPool = selectBestMomentsLocally({
    transcript,
    chapters,
    clipLength,
    clipCount: Math.max(maxPossibleClips * 3, 10),
    videoDuration,
    videoTitle,
    author,
  });

  for (const candidate of fallbackPool) {
    if (selected.length >= maxPossibleClips) break;
    if (!overlapsExisting(candidate.start, candidate.end)) {
      selected.push(candidate);
    }
  }

  // Final deterministic scan across free non-overlapping intervals ranked by viral hook score
  if (selected.length < maxPossibleClips && videoDuration >= effectiveClipLength) {
    const hashtags = buildHashtags(videoTitle, author);
    const baseTitle = videoTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const shortTitle = baseTitle.length > 48 ? `${baseTitle.slice(0, 45).trim()}...` : baseTitle;
    const labels = [
      'Viral Hook',
      'Standout Moment',
      'Key Highlight',
      'Core Takeaway',
      'Closing Peak',
    ];

    const slotCandidates: Array<MomentSelection & { priority: number }> = [];
    for (
      let cursor = 0;
      cursor + effectiveClipLength <= videoDuration;
      cursor += Math.max(2, Math.floor(effectiveClipLength / 3))
    ) {
      const start = Number(cursor.toFixed(2));
      const end = Number(Math.min(videoDuration, start + effectiveClipLength).toFixed(2));
      if (overlapsExisting(start, end)) continue;

      const windowSegs = transcript.filter((seg) => seg.end > start && seg.start < end);
      const openingText = stripStageCues(
        windowSegs
          .filter((seg) => seg.start - start <= 4.5)
          .map((seg) => seg.text)
          .join(' ')
      );
      const windowText = stripStageCues(windowSegs.map((seg) => seg.text).join(' '));
      const priority = windowText
        ? scoreViralHookWindow(openingText || windowText, windowText)
        : 75;

      slotCandidates.push({
        start,
        end,
        title:
          windowText.length >= 10
            ? cleanSnippetTitle(openingText || windowText, videoTitle, slotCandidates.length)
            : `${shortTitle} — ${labels[slotCandidates.length % labels.length]}`,
        caption:
          windowText.length >= 10
            ? `"${windowText.length > 150 ? `${windowText.slice(0, 147).trim()}...` : windowText}" — ${author} ${hashtags}`
            : `${labels[slotCandidates.length % labels.length]} from "${videoTitle}" by ${author}. ${hashtags}`,
        score: Math.min(92, Math.max(76, priority)),
        priority,
      });
    }

    slotCandidates.sort((a, b) => b.priority - a.priority);
    for (const slot of slotCandidates) {
      if (selected.length >= maxPossibleClips) break;
      if (!overlapsExisting(slot.start, slot.end)) {
        selected.push({
          start: slot.start,
          end: slot.end,
          title: slot.title,
          caption: slot.caption,
          score: slot.score,
        });
      }
    }
  }

  return selected.sort((a, b) => b.score - a.score);
}

/**
 * Selects the best viral hook moments from a real YouTube video using:
 * 1. Claude API (if CLAUDE_API_KEY is configured)
 * 2. Gemini API (if GEMINI_API_KEY is configured and transcript exists)
 * 3. Local real-transcript & chapter viral hook scorer (zero dummy data)
 * Always tops up to the requested clipCount whenever video duration supports non-overlapping clips.
 */
export async function selectBestMoments(params: {
  transcript: TranscriptSegment[];
  chapters: YouTubeChapter[];
  clipLength: ClipLength;
  clipCount: number;
  videoDuration: number;
  videoTitle: string;
  author: string;
}): Promise<MomentSelection[]> {
  let aiMoments: MomentSelection[] = [];

  if (
    config.claudeApiKey &&
    params.transcript.length > 0 &&
    params.videoDuration >= params.clipLength - 2
  ) {
    try {
      aiMoments = await findBestMomentsWithClaude({
        transcript: params.transcript,
        clipLength: params.clipLength,
        clipCount: params.clipCount,
        videoDuration: params.videoDuration,
        videoTitle: params.videoTitle,
      });
    } catch (err) {
      logger.warn('Claude moment selection failed; falling back to next selector', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  if (
    aiMoments.length === 0 &&
    process.env.GEMINI_API_KEY?.trim() &&
    params.transcript.length > 0 &&
    params.videoDuration >= params.clipLength - 2
  ) {
    try {
      aiMoments = await findBestMomentsWithGemini({
        transcript: params.transcript,
        clipLength: params.clipLength,
        clipCount: params.clipCount,
        videoDuration: params.videoDuration,
        videoTitle: params.videoTitle,
      });
    } catch (err) {
      logger.warn('Gemini moment selection failed; falling back to local transcript scorer', {
        reason: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return topUpMomentsToCount({
    existing: aiMoments,
    transcript: params.transcript,
    chapters: params.chapters,
    clipLength: params.clipLength,
    clipCount: params.clipCount,
    videoDuration: params.videoDuration,
    videoTitle: params.videoTitle,
    author: params.author,
  });
}
