import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { MomentSelection, TranscriptSegment } from '../types.js';

const execFileAsync = promisify(execFile);

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

/**
 * Generates an ASS subtitle file with bold lower-third captions calibrated for 1080x1920 vertical video.
 */
export function buildAssSubtitles(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number
): string {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: LowerThird,DejaVu Sans,68,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,2,2,72,72,260,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const dialogues: string[] = [];

  for (const seg of segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    const relStart = Math.max(0, seg.start - clipStart);
    const relEnd = Math.min(clipEnd - clipStart, seg.end - clipStart);
    if (relEnd <= relStart) continue;

    dialogues.push(
      `Dialogue: 0,${formatAssTime(relStart)},${formatAssTime(relEnd)},LowerThird,,0,0,0,,${escapeAssText(seg.text.toUpperCase())}`
    );
  }

  return [...header, ...dialogues, ''].join('\n');
}

export interface RenderedClipArtifacts {
  videoPath: string;
  posterPath: string | null;
}

/**
 * Cuts a single moment from a local source video OR direct YouTube stream URL, converts to 9:16
 * vertical MP4 with a blurred background fill and centered original frame, optionally burns in
 * bold lower-third captions, and exports H.264 + AAC MP4 plus a JPEG poster frame.
 */
export async function renderVerticalClip(params: {
  sourceInput: string;
  userAgent?: string;
  jobDir: string;
  clipIndex: number;
  moment: MomentSelection;
  transcript: TranscriptSegment[];
  captions: boolean;
  resolution?: '720x1280' | '1080x1920';
}): Promise<RenderedClipArtifacts> {
  const {
    sourceInput,
    userAgent,
    jobDir,
    clipIndex,
    moment,
    transcript,
    captions,
    resolution = '1080x1920',
  } = params;

  const resolvedBase = path.resolve(jobDir);
  const outputFilename = `clip-${clipIndex + 1}.mp4`;
  const posterFilename = `clip-${clipIndex + 1}.jpg`;
  const outputPath = path.resolve(jobDir, outputFilename);
  const posterPath = path.resolve(jobDir, posterFilename);

  if (
    !outputPath.startsWith(resolvedBase + path.sep) ||
    !posterPath.startsWith(resolvedBase + path.sep)
  ) {
    throw new Error('Invalid clip output path.');
  }

  const [width, height] = resolution === '720x1280' ? [720, 1280] : [1080, 1920];
  const duration = Number(Math.max(1, moment.end - moment.start).toFixed(2));
  const subtitleFilename = `clip-${clipIndex + 1}.ass`;

  const relevantTranscript = transcript.filter(
    (seg) => seg.end > moment.start && seg.start < moment.end
  );

  let subtitleFilter = '';
  if (captions && relevantTranscript.length > 0) {
    const assContent = buildAssSubtitles(relevantTranscript, moment.start, moment.end);
    const subtitlePath = path.resolve(jobDir, subtitleFilename);
    if (!subtitlePath.startsWith(resolvedBase + path.sep)) {
      throw new Error('Invalid subtitle path.');
    }
    await fs.writeFile(subtitlePath, assContent, 'utf8');
    subtitleFilter = `,ass=${subtitleFilename}`;
  }

  // Blurred vertical background fill + centered original video
  const filterComplex = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:3[bg]`,
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2${subtitleFilter}[vout]`,
  ].join(';');

  const inputArgs: string[] = ['-y', '-loglevel', 'error'];
  if (userAgent && /^https:\/\//i.test(sourceInput)) {
    inputArgs.push('-user_agent', userAgent);
  }

  await execFileAsync(
    'ffmpeg',
    [
      ...inputArgs,
      '-ss',
      moment.start.toFixed(2),
      '-t',
      duration.toFixed(2),
      '-i',
      sourceInput,
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputFilename,
    ],
    { cwd: resolvedBase, timeout: 4 * 60_000 }
  );

  await fs.access(outputPath);

  // Extract a crisp JPEG poster frame from the rendered 9:16 clip
  let savedPoster: string | null = null;
  try {
    const posterOffset = Math.min(1.5, duration / 3).toFixed(2);
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        posterOffset,
        '-i',
        outputFilename,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        posterFilename,
      ],
      { cwd: resolvedBase, timeout: 30_000 }
    );
    await fs.access(posterPath);
    savedPoster = posterPath;
  } catch {
    savedPoster = null;
  }

  return { videoPath: outputPath, posterPath: savedPoster };
}
