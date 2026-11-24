import { useEffect, useRef, useState } from 'react';
import { Film, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { ClipItem } from '../types';
import { formatDuration } from '../utils/youtube';

interface VerticalVideoPlayerProps {
  clip: ClipItem;
}

const SAFE_YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

export function VerticalVideoPlayer({ clip }: VerticalVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(clip.duration || 15);
  const [videoError, setVideoError] = useState(false);
  const [embedActive, setEmbedActive] = useState(false);

  const isEmbedMode =
    clip.playbackMode === 'youtube-embed' &&
    typeof clip.videoId === 'string' &&
    SAFE_YOUTUBE_ID_REGEX.test(clip.videoId);

  // Only draw HTML caption overlay for YouTube embed clips or mock sample clips;
  // server-rendered MP4 clips already have bold captions burned directly into the video via ffmpeg.
  const shouldRenderHtmlCaptions =
    Boolean(clip.captionsEnabled) &&
    Boolean(clip.captionCues && clip.captionCues.length > 0) &&
    (isEmbedMode || clip.videoUrl.startsWith('/samples/'));

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoError(false);
    setEmbedActive(false);
  }, [clip.id, clip.videoUrl]);

  const togglePlay = async () => {
    if (isEmbedMode) {
      setEmbedActive((prev) => !prev);
      return;
    }

    const video = videoRef.current;
    if (!video || videoError) return;

    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        // Retry muted if browser autoplay policy requires muted playback first
        try {
          video.muted = true;
          setIsMuted(true);
          await video.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
        }
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleSeek = (nextValue: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(mediaDuration) || mediaDuration <= 0) return;
    const clamped = Math.min(mediaDuration, Math.max(0, nextValue));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const activeCaption = shouldRenderHtmlCaptions && clip.captionCues
    ? (clip.captionCues.find(
        (cue) => currentTime >= cue.start && currentTime <= cue.end
      )?.text ?? clip.captionCues[0].text)
    : null;

  const progressRatio = mediaDuration > 0 ? Math.min(100, (currentTime / mediaDuration) * 100) : 0;

  const embedSrc =
    isEmbedMode && clip.videoId
      ? `https://www.youtube.com/embed/${clip.videoId}?start=${Math.max(0, Math.floor(clip.startTime ?? 0))}&end=${Math.max(1, Math.ceil(clip.endTime ?? clip.duration))}&autoplay=1&rel=0&modestbranding=1&playsinline=1`
      : null;

  return (
    <div className="flex justify-center rounded-t-2xl bg-[#07070C] px-3 pt-3">
      <div className="relative aspect-[9/16] w-full max-w-[248px] overflow-hidden rounded-xl bg-[#050509] shadow-inner">
        {isEmbedMode ? (
          <div className="relative flex h-full w-full items-center justify-center bg-[#06060B]">
            {/* Blurred 9:16 vertical fill from the real YouTube video's thumbnail */}
            {clip.posterUrl && (
              <img
                src={clip.posterUrl}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover blur-xl opacity-55"
              />
            )}

            {embedActive && embedSrc ? (
              <iframe
                src={embedSrc}
                title={clip.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="relative z-10 aspect-video w-full border-0 shadow-2xl"
              />
            ) : clip.posterUrl ? (
              <img
                src={clip.posterUrl}
                alt={clip.title}
                referrerPolicy="no-referrer"
                className="relative z-10 aspect-video w-full object-cover shadow-2xl"
              />
            ) : (
              <div className="relative z-10 flex flex-col items-center gap-2 p-4 text-center">
                <Film className="h-8 w-8 text-zinc-400" aria-hidden="true" />
                <p className="text-xs text-zinc-300">{clip.title}</p>
              </div>
            )}
          </div>
        ) : !videoError ? (
          <video
            ref={videoRef}
            src={clip.videoUrl}
            poster={clip.posterUrl}
            playsInline
            loop
            muted={isMuted}
            preload="metadata"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
                setMediaDuration(e.currentTarget.duration);
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => setVideoError(true)}
            className="h-full w-full object-cover"
          />
        ) : clip.posterUrl ? (
          <img
            src={clip.posterUrl}
            alt={clip.title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#171726] to-[#0B0B12] p-6 text-center">
            <Film className="h-10 w-10 text-zinc-500" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-300">{clip.title}</p>
          </div>
        )}

        {/* Measured top & bottom scrims for WCAG AA contrast */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-20 bg-gradient-to-b from-black/75 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28 bg-gradient-to-t from-black/85 via-black/45 to-transparent"
        />

        {/* Top row: Duration badge & Virality score badge */}
        <div className="absolute inset-x-2.5 top-2.5 z-30 flex items-center justify-between gap-2">
          <span
            aria-label={`Duration ${formatDuration(clip.duration)}`}
            className="rounded-md bg-black/75 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-white backdrop-blur-sm border border-white/10"
          >
            {formatDuration(clip.duration)}
          </span>

          <span
            aria-label={`Virality score ${clip.score} out of 100`}
            className="rounded-md bg-black/75 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-white backdrop-blur-sm border border-fuchsia-400/35"
          >
            Score <span className="text-fuchsia-300">{clip.score}</span>/100
          </span>
        </div>

        {/* Center Play / Pause button (hidden while YouTube iframe is actively playing) */}
        {!(isEmbedMode && embedActive) && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? `Pause "${clip.title}"` : `Play "${clip.title}"`}
            className={`absolute left-1/2 top-1/2 z-30 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white backdrop-blur-md transition-all duration-150 hover:scale-105 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 ${
              isPlaying ? 'opacity-0 hover:opacity-100 focus-visible:opacity-100' : 'opacity-100'
            }`}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 fill-current" aria-hidden="true" />
            ) : (
              <Play className="h-5 w-5 translate-x-0.5 fill-current" aria-hidden="true" />
            )}
          </button>
        )}

        {/* Lower-third caption preview (for mock mode or YouTube embed clips) */}
        {activeCaption && !(isEmbedMode && embedActive) && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-3 bottom-12 z-30 flex justify-center"
          >
            <p className="rounded-md bg-black/80 px-2.5 py-1 text-center text-xs font-extrabold uppercase tracking-wide text-white shadow-lg leading-tight">
              {activeCaption}
            </p>
          </div>
        )}

        {/* Bottom control bar */}
        {isEmbedMode ? (
          <div className="absolute inset-x-2.5 bottom-2.5 z-30 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-zinc-200">
            <span className="rounded bg-black/70 px-2 py-0.5">
              {formatDuration(clip.startTime ?? 0)} – {formatDuration(clip.endTime ?? clip.duration)}
            </span>
            {embedActive && (
              <button
                type="button"
                onClick={() => setEmbedActive(false)}
                className="rounded bg-black/75 px-2 py-0.5 text-zinc-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
              >
                Reset preview
              </button>
            )}
          </div>
        ) : (
          <div className="absolute inset-x-2.5 bottom-2.5 z-30 flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? `Pause video ${clip.title}` : `Play video ${clip.title}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/65 text-white hover:bg-black/85 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            <div className="relative flex flex-1 items-center">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-400 to-pink-400 transition-all duration-100"
                  style={{ width: `${progressRatio}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={mediaDuration}
                step={0.1}
                value={currentTime}
                aria-label={`Seek ${clip.title}`}
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="absolute inset-0 h-5 w-full cursor-pointer opacity-0"
              />
            </div>

            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? `Unmute ${clip.title}` : `Mute ${clip.title}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/65 text-white hover:bg-black/85 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              {isMuted ? (
                <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
