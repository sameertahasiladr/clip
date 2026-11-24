import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { ClipLength, MomentSelection, TranscriptSegment } from '../types.js';
import { validateSelectedMoments } from '../validation.js';
import { findBestMomentsWithClaude } from './claude.js';
import type { YouTubeChapter } from './youtubeFetch.js';

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
  'simple',
  'crazy',
  'realize',
  'important',
  'first',
  'only',
  'always',
];

function buildHashtags(videoTitle: string, author: string): string {
  const words = `${videoTitle} ${author}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['official', 'video', 'youtube', 'remaster', 'shorts', 'with', 'from', 'this', 'that'].includes(w));

  const unique = Array.from(new Set(words)).slice(0, 2);
  const tags = ['#shorts', ...unique.map((w) => `#${w}`)];
  return tags.join(' ');
}

function cleanSnippetTitle(rawText: string, fallbackTitle: string, clipIndex: number): string {
  const cleaned = rawText
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[♪♫]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length >= 12) {
    const firstSentence = cleaned.split(/[.!?]/)[0]?.trim() || cleaned;
    const words = firstSentence.split(/\s+/).slice(0, 10).join(' ');
    const capped = words.length > 72 ? `${words.slice(0, 69).trim()}...` : words;
    return capped.charAt(0).toUpperCase() + capped.slice(1);
  }

  const base = fallbackTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const shortBase = base.length > 54 ? `${base.slice(0, 51).trim()}...` : base;
  return `${shortBase} — Highlight ${clipIndex + 1}`;
}

function scoreTranscriptWindow(text: string, wordCount: number, isNearStart: boolean): number {
  const lower = text.toLowerCase();
  let score = 74;

  // Reward strong opening hooks & punchlines
  for (const kw of HOOK_KEYWORDS) {
    if (lower.includes(kw)) score += 3;
  }
  if (text.includes('?')) score += 5;
  if (text.includes('!')) score += 4;
  if (/\d+/.test(text)) score += 4;
  if (wordCount >= 28 && wordCount <= 95) score += 6;
  if (isNearStart) score += 3;

  return Math.min(97, Math.max(76, Math.round(score)));
}

/**
 * Deterministic real-content moment selector built directly from the video's actual transcript,
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
  const maxPossibleClips = Math.max(1, Math.min(clipCount, Math.floor(videoDuration / effectiveClipLength) || 1));

  // 1. Transcript-driven sentence-boundary window scoring
  if (transcript.length >= 2 && videoDuration >= effectiveClipLength) {
    const candidates: MomentSelection[] = [];
    const minLen = Math.max(4, effectiveClipLength - 2);
    const maxLen = effectiveClipLength + 2;

    for (let i = 0; i < transcript.length; i++) {
      const windowStart = transcript[i].start;
      if (windowStart + minLen > videoDuration) break;

      let j = i;
      const parts: string[] = [];
      let windowEnd = transcript[i].end;

      while (j < transcript.length) {
        const seg = transcript[j];
        const nextEnd = Math.min(videoDuration, seg.end);
        if (nextEnd - windowStart > maxLen && parts.length > 0) {
          break;
        }
        parts.push(seg.text);
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

      const combinedText = parts
        .join(' ')
        .replace(/\[[^\]]+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!combinedText) continue;

      const wordCount = combinedText.split(/\s+/).length;
      const score = scoreTranscriptWindow(combinedText, wordCount, windowStart < videoDuration * 0.25);
      const quotePreview =
        combinedText.length > 155 ? `${combinedText.slice(0, 152).trim()}...` : combinedText;

      candidates.push({
        start: Number(windowStart.toFixed(2)),
        end: Number(windowEnd.toFixed(2)),
        title: cleanSnippetTitle(combinedText, videoTitle, candidates.length),
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

  // 2. Chapter-driven highlights if the video includes description chapters
  if (chapters.length > 0 && videoDuration >= effectiveClipLength) {
    const picked: MomentSelection[] = [];
    for (let i = 0; i < chapters.length && picked.length < maxPossibleClips; i++) {
      const ch = chapters[i];
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

  // 3. Evenly spaced non-overlapping highlights across the real video's duration
  const results: MomentSelection[] = [];
  const usableStart = videoDuration > effectiveClipLength * 2 ? Math.min(12, Math.floor(videoDuration * 0.08)) : 0;
  const usableSpan = Math.max(effectiveClipLength, videoDuration - usableStart);
  const stride = maxPossibleClips > 1
    ? Math.max(effectiveClipLength + 1, Math.floor((usableSpan - effectiveClipLength) / (maxPossibleClips - 1)))
    : effectiveClipLength;

  const baseTitle = videoTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const shortTitle = baseTitle.length > 48 ? `${baseTitle.slice(0, 45).trim()}...` : baseTitle;
  const labels = ['Opening Hook', 'Peak Moment', 'Key Takeaway', 'Standout Highlight', 'Closing Punchline'];

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
      `Pick the ${params.clipCount} best viral short moments.`,
      `Rules: each moment must be ${params.clipLength} seconds (+/- 2s), start and end on sentence boundaries, have zero overlaps, and prioritize strong hooks, punchlines, and insights.`,
      '',
      'Timestamped transcript:',
      transcriptText,
    ].join('\n'),
    config: {
      systemInstruction:
        'You are a short-form video editor. Return ONLY a JSON array of the best viral moments matching the schema.',
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

  // Pull candidate pool from local real transcript / chapter scorer
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

  // Final deterministic scan across free non-overlapping intervals in the real video
  if (selected.length < maxPossibleClips && videoDuration >= effectiveClipLength) {
    const hashtags = buildHashtags(videoTitle, author);
    const baseTitle = videoTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const shortTitle = baseTitle.length > 48 ? `${baseTitle.slice(0, 45).trim()}...` : baseTitle;
    const labels = [
      'Opening Hook',
      'Standout Moment',
      'Key Highlight',
      'Core Takeaway',
      'Closing Peak',
    ];

    // Walk in 1-second increments to locate free non-overlapping slots
    for (
      let cursor = 0;
      cursor + effectiveClipLength <= videoDuration && selected.length < maxPossibleClips;
      cursor += 1
    ) {
      const start = Number(cursor.toFixed(2));
      const end = Number(Math.min(videoDuration, start + effectiveClipLength).toFixed(2));
      if (overlapsExisting(start, end)) continue;

      const windowText = transcript
        .filter((seg) => seg.end > start && seg.start < end)
        .map((seg) => seg.text)
        .join(' ')
        .replace(/\[[^\]]+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const idx = selected.length;
      const label = labels[idx] ?? `Highlight ${idx + 1}`;
      const title =
        windowText.length >= 12
          ? cleanSnippetTitle(windowText, videoTitle, idx)
          : `${shortTitle} — ${label}`;
      const caption =
        windowText.length >= 12
          ? `"${windowText.length > 150 ? `${windowText.slice(0, 147).trim()}...` : windowText}" — ${author} ${hashtags}`
          : `${label} from "${videoTitle}" by ${author}. ${hashtags}`;

      selected.push({
        start,
        end,
        title,
        caption,
        score: Math.max(78, 89 - idx * 2),
      });

      cursor += effectiveClipLength;
    }
  }

  return selected.sort((a, b) => b.score - a.score);
}

/**
 * Selects the best viral moments from a real YouTube video using:
 * 1. Claude API (if CLAUDE_API_KEY is configured)
 * 2. Gemini API (if GEMINI_API_KEY is configured and transcript exists)
 * 3. Local real-transcript & chapter hook scorer (zero dummy data)
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

  if (config.claudeApiKey && params.transcript.length > 0 && params.videoDuration >= params.clipLength - 2) {
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
