import { config } from '../config.js';
import type { ClipLength, MomentSelection, TranscriptSegment } from '../types.js';
import { validateSelectedMoments } from '../validation.js';

function formatTranscriptForPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => `[${seg.start.toFixed(2)} - ${seg.end.toFixed(2)}] ${seg.text}`)
    .join('\n');
}

function extractJsonArray(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const firstBracket = candidate.indexOf('[');
  const lastBracket = candidate.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new Error('Claude response did not contain a JSON array.');
  }

  return JSON.parse(candidate.slice(firstBracket, lastBracket + 1));
}

/**
 * Calls the Anthropic Claude Messages API to identify the N best viral short moments.
 */
export async function findBestMomentsWithClaude(params: {
  transcript: TranscriptSegment[];
  clipLength: ClipLength;
  clipCount: number;
  videoDuration: number;
  videoTitle: string;
}): Promise<MomentSelection[]> {
  if (!config.claudeApiKey) {
    throw new Error('CLAUDE_API_KEY is not configured on the server.');
  }

  const { transcript, clipLength, clipCount, videoDuration, videoTitle } = params;
  const formattedTranscript = formatTranscriptForPrompt(transcript);

  const systemPrompt = [
    'You are an expert short-form video editor specializing in YouTube Shorts, Instagram Reels, and Facebook Reels.',
    'Respond with STRICT JSON ONLY: a JSON array of objects, with no markdown fences, no commentary, and no extra keys.',
    'Each object must have exactly these keys: "start" (number, seconds), "end" (number, seconds), "title" (string), "caption" (string with 2-3 relevant hashtags), and "score" (integer 0-100 representing virality potential).',
  ].join(' ');

  const userPrompt = [
    `Video title: "${videoTitle}"`,
    `Total duration: ${videoDuration.toFixed(2)} seconds.`,
    `Select the ${clipCount} best moments for vertical short-form clips.`,
    'Rules:',
    `- Each moment MUST be ${clipLength} seconds long (+/- 2 seconds, so between ${clipLength - 2} and ${clipLength + 2} seconds).`,
    '- Every moment MUST start and end cleanly on natural sentence boundaries from the transcript.',
    '- Moments MUST NOT overlap with each other.',
    '- Prioritize strong opening hooks, surprising claims, emotional punchlines, and actionable key insights.',
    '- Return strictly a valid JSON array.',
    '',
    'Timestamped transcript:',
    formattedTranscript,
  ].join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.claudeModel,
      max_tokens: 2048,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Claude API request failed (HTTP ${response.status}): ${errorText.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const textBlock = payload.content?.find((block) => block.type === 'text')?.text ?? '';
  const parsedJson = extractJsonArray(textBlock);

  return validateSelectedMoments(parsedJson, clipLength, clipCount, videoDuration);
}
