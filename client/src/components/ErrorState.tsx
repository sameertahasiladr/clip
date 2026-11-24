import { AlertTriangle, PlayCircle, RotateCcw } from 'lucide-react';

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  onTrySample?: () => void;
}

export function ErrorState({ message, onRetry, onTrySample }: ErrorStateProps) {
  const isCloudBotBlock = /confirm you.?re not a bot|YTDLP_COOKIES_B64/i.test(message);

  return (
    <section aria-label="Generation error" className="mx-auto max-w-2xl py-10">
      <div
        role="alert"
        className="rounded-2xl border border-rose-500/30 bg-[#17111A] p-6 sm:p-8 text-center"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-white">Could not generate clips</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-zinc-300">{message}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 px-6 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Try again</span>
          </button>

          {isCloudBotBlock && onTrySample && (
            <button
              type="button"
              onClick={onTrySample}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-white/[0.1] transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              <span>Try Working Sample Link</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
