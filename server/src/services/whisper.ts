import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { TranscriptSegment } from '../types.js';

const execFileAsync = promisify(execFile);

const WHISPER_CHUNK_SECONDS = 40 * 60; // 40 min at 32k mono MP3 (~9.6 MB, well below Whisper's 25 MB cap)

/**
 * Extracts compressed mono speech audio (MP3) in <=40-minute chunks using ffmpeg,
 * then translates each chunk with OpenAI Whisper API and merges exact timestamps
 * so long videos up to 360 minutes (6 hours) transcribe without hitting the 25 MB limit.
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
  const chunkPattern = path.resolve(jobDir, 'audio-%03d.mp3');
  if (!chunkPattern.startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid audio extraction path.');
  }

  // Extract lightweight 16kHz mono 32kbps MP3 chunks suitable for Whisper API 25MB limit
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
      '32k',
      '-f',
      'segment',
      '-segment_time',
      String(WHISPER_CHUNK_SECONDS),
      '-reset_timestamps',
      '1',
      chunkPattern,
    ],
    { timeout: 15 * 60_000 }
  );

  const files = (await fs.readdir(resolvedBase))
    .filter((name) => /^audio-\d{3}\.mp3$/.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error('Could not extract audio track for Whisper transcription.');
  }

  const allSegments: TranscriptSegment[] = [];

  for (let chunkIndex = 0; chunkIndex < files.length; chunkIndex++) {
    const chunkPath = path.resolve(resolvedBase, files[chunkIndex]);
    if (!chunkPath.startsWith(resolvedBase + path.sep)) {
      throw new Error('Invalid audio chunk path.');
    }

    const audioBuffer = await fs.readFile(chunkPath);
    if (audioBuffer.length < 1024) continue;

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), files[chunkIndex]);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    // Use /v1/audio/translations so speech in any language always returns timestamped English captions
    const response = await fetch('https://api.openai.com/v1/audio/translations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Whisper English translation failed (HTTP ${response.status}): ${errorText.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    const timeOffset = chunkIndex * WHISPER_CHUNK_SECONDS;
    for (const seg of data.segments ?? []) {
      const start = Number((seg.start + timeOffset).toFixed(2));
      const end = Number((seg.end + timeOffset).toFixed(2));
      const text = seg.text.trim();
      if (end > start && text.length > 0) {
        allSegments.push({ start, end, text });
      }
    }
  }

  if (allSegments.length === 0) {
    throw new Error('Whisper returned an empty transcript for this video.');
  }

  return allSegments;
}
