import { Check, Loader2 } from 'lucide-react';
import { JOB_STEPS, type JobStep } from '../types';

interface ProcessingStepperProps {
  currentStep: JobStep;
  progress: number;
  sourceUrl: string;
  onCancel: () => void;
}

export function ProcessingStepper({
  currentStep,
  progress,
  sourceUrl,
  onCancel,
}: ProcessingStepperProps) {
  const activeIndex = Math.max(0, JOB_STEPS.indexOf(currentStep));
  const clampedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <section
      aria-label="Clip generation progress"
      aria-live="polite"
      className="mx-auto max-w-4xl py-8 sm:py-12"
    >
      <div className="rounded-2xl border border-white/[0.09] bg-[#12121C] p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-white">Creating your vertical shorts</h2>
            <p className="mt-1 truncate text-sm text-zinc-400" title={sourceUrl}>
              Source: {sourceUrl}
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="font-mono text-2xl font-semibold tabular-nums text-white">
              {clampedProgress}%
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.09] hover:text-white transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Processing progress: ${currentStep}`}
          className="mt-6 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.max(4, clampedProgress)}%` }}
          />
        </div>

        {/* 5-Stage Stepper */}
        <ol className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-3">
          {JOB_STEPS.map((step, index) => {
            const isComplete = index < activeIndex || (currentStep === 'Done' && index === activeIndex);
            const isActive = index === activeIndex && currentStep !== 'Done';

            return (
              <li
                key={step}
                aria-current={isActive ? 'step' : undefined}
                className={`flex sm:flex-col items-center sm:items-start gap-3 rounded-xl p-3.5 transition-colors duration-200 ${
                  isActive
                    ? 'bg-fuchsia-500/[0.11] ring-1 ring-inset ring-fuchsia-400/45'
                    : isComplete
                      ? 'bg-white/[0.03]'
                      : 'bg-transparent'
                }`}
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-mono font-semibold ${
                    isComplete
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white'
                      : isActive
                        ? 'border border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-200'
                        : 'border border-white/15 bg-white/[0.04] text-zinc-400'
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium leading-snug ${
                      isActive || isComplete ? 'text-white' : 'text-zinc-300'
                    }`}
                  >
                    {step}
                  </p>
                  <p
                    className={`mt-0.5 text-xs ${
                      isActive ? 'text-fuchsia-300' : isComplete ? 'text-zinc-400' : 'text-zinc-500'
                    }`}
                  >
                    {isComplete ? 'Completed' : isActive ? 'In progress' : 'Waiting'}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
