import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { TranscriptSegment } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Extracts compressed mono speech audio (MP3) using ffmpeg, then transcribes with OpenAI Whisper API.
 */
export async function transcribeWithWhisper(
  videoPath: string,
  jobDir: string
): Promise<TranscriptSegment[]> {
  if (!config.openaiApiKey) {
    throw new Error(
      'No YouTube captions were found and OPENAI_API_KEY is not configured for Whisper transcription.'
    );
  }

  const resolvedBase = path.resolve(jobDir);
  const audioPath = path.resolve(jobDir, 'audio.mp3');
  if (!audioPath.startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid audio extraction path.');
  }

  // Extract lightweight 16kHz mono MP3 suitable for Whisper API 25MB limit
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '48k',
      audioPath,
    ],
    { timeout: 5 * 60_000 }
  );

  const audioBuffer = await fs.readFile(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Whisper transcription failed (HTTP ${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  const segments = (data.segments ?? [])
    .map((seg) => ({
      start: Number(seg.start.toFixed(2)),
      end: Number(seg.end.toFixed(2)),
      text: seg.text.trim(),
    }))
    .filter((seg) => seg.end > seg.start && seg.text.length > 0);

  if (segments.length === 0) {
    throw new Error('Whisper returned an empty transcript for this video.');
  }

  return segments;
}
