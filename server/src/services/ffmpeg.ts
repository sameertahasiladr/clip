import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AudioMode, MomentSelection, TranscriptSegment, VideoLayout } from '../types.js';

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

function sanitizeCaptionText(raw: string): string {
  return raw
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*music[^)]*\)/gi, ' ')
    .replace(/[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Wraps a short caption chunk into at most two balanced lines (<= maxLineChars per line)
 * so bold lower-third captions stay comfortably inside the 1080px vertical safe zone.
 */
function wrapCaptionLines(text: string, maxLineChars = 20): string {
  const upper = text.toUpperCase();
  if (upper.length <= maxLineChars) return upper;

  const words = upper.split(/\s+/);
  if (words.length <= 1) return upper;

  // Find the split point that balances line lengths closest to the middle
  let bestSplit = 1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(' ');
    const line2 = words.slice(i).join(' ');
    const overflow =
      Math.max(0, line1.length - maxLineChars) + Math.max(0, line2.length - maxLineChars);
    const imbalance = Math.abs(line1.length - line2.length);
    const score = overflow * 10 + imbalance;
    if (score < bestScore) {
      bestScore = score;
      bestSplit = i;
    }
  }

  return `${words.slice(0, bestSplit).join(' ')}\n${words.slice(bestSplit).join(' ')}`;
}

/**
 * Splits a long transcript segment into fast-paced short-form caption cues (max 6 words / ~34 chars)
 * distributed proportionally across the segment's timestamp range.
 */
function chunkSegmentForCaptions(
  text: string,
  relStart: number,
  relEnd: number,
  maxWordsPerCue = 6,
  maxCharsPerCue = 34
): Array<{ start: number; end: number; text: string }> {
  const cleaned = sanitizeCaptionText(text);
  if (!cleaned) return [];

  const words = cleaned.split(/\s+/);
  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    const candidate = [...current, word].join(' ');
    if (
      current.length > 0 &&
      (current.length >= maxWordsPerCue || candidate.length > maxCharsPerCue)
    ) {
      chunks.push(current.join(' '));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) {
    chunks.push(current.join(' '));
  }

  const totalDuration = relEnd - relStart;
  const totalWords = words.length || 1;
  let cursor = relStart;

  return chunks.map((chunk, idx) => {
    const chunkWords = chunk.split(/\s+/).length;
    const isLast = idx === chunks.length - 1;
    const end = isLast ? relEnd : Math.min(relEnd, cursor + totalDuration * (chunkWords / totalWords));
    const cue = {
      start: cursor,
      end: Math.max(cursor + 0.15, end),
      text: wrapCaptionLines(chunk),
    };
    cursor = cue.end;
    return cue;
  });
}

/**
 * Generates an ASS subtitle file with bold, non-clipping lower-third captions calibrated for 1080x1920 vertical video.
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
    'Style: LowerThird,DejaVu Sans,56,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,250,1',
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

    const cues = chunkSegmentForCaptions(seg.text, relStart, relEnd);
    for (const cue of cues) {
      dialogues.push(
        `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},LowerThird,,0,0,0,,${escapeAssText(cue.text)}`
      );
    }
  }

  return [...header, ...dialogues, ''].join('\n');
}

export interface RenderedClipArtifacts {
  videoPath: string;
  posterPath: string | null;
}

export type ClipResolution = '720x1280' | '1080x1920' | '2160x3840';

/**
 * Builds the FFmpeg filter_complex string for either:
 * - 'vertical-fill': true full-bleed 9:16 vertical center-crop filling 100% of the 4K/HD frame
 * - 'vertical-blur': original horizontal video centered inside a 9:16 vertical frame with blurred background fill
 */
export function buildVerticalFilterComplex(params: {
  width: number;
  height: number;
  videoLayout: VideoLayout;
  subtitleFilter: string;
  videoFilter?: string;
}): string {
  const { width, height, videoLayout, subtitleFilter, videoFilter } = params;
  if (videoFilter) {
    return `[0:v]${videoFilter},unsharp=5:5:0.35:3:3:0.0,setsar=1${subtitleFilter}[vout]`;
  }

  const lanczosFlags = 'lanczos+accurate_rnd+full_chroma_int';
  const sharpen = 'unsharp=5:5:0.45:3:3:0.0';

  if (videoLayout === 'vertical-blur') {
    const blurRadius = width >= 2160 ? '36:4' : '20:3';
    return [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},boxblur=${blurRadius}[bg]`,
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=${lanczosFlags},${sharpen}[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${subtitleFilter}[vout]`,
    ].join(';');
  }

  return `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=${lanczosFlags},crop=${width}:${height},${sharpen},setsar=1${subtitleFilter}[vout]`;
}

/**
 * 4K / High-Definition H.264 + AAC Shorts/Reels encoding arguments:
 * 20000k target bitrate (35000k maxrate) for 4K 2160x3840 at High@5.2, BT.709 color metadata, and 192 kbps 48 kHz audio.
 */
export function buildHighQualityEncodeArgs(
  videoBitrate = '20000k',
  resolution: ClipResolution = '2160x3840',
  includeAudio = true
): string[] {
  const is4K = resolution === '2160x3840';
  const level = is4K ? '5.2' : '4.2';
  const maxRate = is4K ? '35000k' : '12000k';
  const bufSize = is4K ? '50000k' : '16000k';
  const preset = is4K ? 'fast' : 'medium';

  const audioArgs = includeAudio
    ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
    : ['-an'];

  return [
    '-sws_flags',
    'lanczos+accurate_rnd+full_chroma_int',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level:v',
    level,
    '-preset',
    preset,
    '-b:v',
    videoBitrate,
    '-maxrate',
    maxRate,
    '-bufsize',
    bufSize,
    '-pix_fmt',
    'yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-aspect',
    '9:16',
    ...audioArgs,
    '-movflags',
    '+faststart',
  ];
}

function parseResolutionDimensions(resolution: ClipResolution): [number, number] {
  if (resolution === '720x1280') return [720, 1280];
  if (resolution === '1080x1920') return [1080, 1920];
  return [2160, 3840];
}

/**
 * Cuts a single moment from a local source video OR direct YouTube stream URL, converts it to
 * 4K 2160x3840 vertical 9:16 MP4 (full-bleed vertical fill by default, or optional horizontal-in-vertical),
 * optionally burns in bold wrapped lower-third English captions, and exports H.264 + AAC MP4 plus a JPEG poster frame.
 */
export async function renderVerticalClip(params: {
  sourceInput: string;
  userAgent?: string;
  jobDir: string;
  clipIndex: number;
  moment: MomentSelection;
  transcript: TranscriptSegment[];
  captions: boolean;
  videoLayout?: VideoLayout;
  audioMode?: AudioMode;
  videoFilter?: string;
  videoBitrate?: string;
  resolution?: ClipResolution;
}): Promise<RenderedClipArtifacts> {
  const {
    sourceInput,
    userAgent,
    jobDir,
    clipIndex,
    moment,
    transcript,
    captions,
    videoLayout = 'vertical-fill',
    audioMode = 'original',
    videoFilter,
    resolution = '2160x3840',
    videoBitrate = resolution === '2160x3840' ? '20000k' : '8000k',
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

  const [width, height] = parseResolutionDimensions(resolution);
  const duration = Number(Math.max(1, moment.end - moment.start).toFixed(2));
  const subtitleFilename = `clip-${clipIndex + 1}.ass`;

  const relevantTranscript = transcript.filter(
    (seg) => seg.end > moment.start && seg.start < moment.end
  );

  let subtitleFilter = '';
  if (captions && relevantTranscript.length > 0) {
    const assContent = buildAssSubtitles(relevantTranscript, moment.start, moment.end);
    if (assContent.includes('Dialogue:')) {
      const subtitlePath = path.resolve(jobDir, subtitleFilename);
      if (!subtitlePath.startsWith(resolvedBase + path.sep)) {
        throw new Error('Invalid subtitle path.');
      }
      await fs.writeFile(subtitlePath, assContent, 'utf8');
      subtitleFilter = `,ass=${subtitleFilename}`;
    }
  }

  const filterComplex = buildVerticalFilterComplex({
    width,
    height,
    videoLayout,
    subtitleFilter,
    videoFilter,
  });

  const inputArgs: string[] = ['-y', '-loglevel', 'error'];
  if (userAgent && /^https:\/\//i.test(sourceInput)) {
    inputArgs.push('-user_agent', userAgent);
  }

  const includeAudio = audioMode !== 'mute';

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
      ...(includeAudio ? ['-map', '0:a?'] : []),
      ...buildHighQualityEncodeArgs(videoBitrate, resolution, includeAudio),
      outputFilename,
    ],
    { cwd: resolvedBase, timeout: 10 * 60_000 }
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
        '2',
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
