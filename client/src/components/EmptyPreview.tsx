import { Captions, Crop, Sparkles } from 'lucide-react';

const WORKFLOW_ITEMS = [
  {
    step: '01',
    title: 'Transcript & Hook Detection',
    description:
      'Extracts timestamped YouTube captions or transcribes spoken audio, then identifies non-overlapping hooks, punchlines, and insights on clean sentence boundaries.',
    Icon: Sparkles,
  },
  {
    step: '02',
    title: '9:16 Vertical Framing',
    description:
      'Cuts each segment to your chosen 15s or 30s target and renders 1080x1920 H.264 MP4s with a blurred-background fill and centered source frame.',
    Icon: Crop,
  },
  {
    step: '03',
    title: 'Lower-Third Captions & Export',
    description:
      'Burns bold, high-contrast captions directly into the lower third so viewers can watch muted, then exports ready-to-upload files with prewritten social captions.',
    Icon: Captions,
  },
] as const;

const EXPORT_SPECS = [
  { label: 'Output resolution', value: '1080 x 1920 (9:16)' },
  { label: 'Video & audio codec', value: 'H.264 + AAC MP4' },
  { label: 'Clip lengths', value: '15s or 30s (±2s)' },
  { label: 'Max source length', value: 'Up to 60 minutes' },
] as const;

export function EmptyPreview() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 pb-16 pt-4">
      <section id="workflow" aria-labelledby="workflow-heading">
        <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="workflow-heading" className="text-xl font-bold text-white sm:text-2xl">
            How ClipGenie builds every short
          </h2>
          <p className="text-sm text-zinc-400">Paste any public YouTube link above to start.</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {WORKFLOW_ITEMS.map(({ step, title, description, Icon }) => (
            <div
              key={step}
              className="rounded-2xl border border-white/[0.08] bg-[#12121C] p-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold tabular-nums text-fuchsia-300">
                  {step}
                </span>
                <Icon className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section
        id="formats"
        aria-labelledby="specs-heading"
        className="border-t border-white/[0.07] pt-10"
      >
        <h2 id="specs-heading" className="text-lg font-bold text-white">
          Export specifications
        </h2>
        <dl className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {EXPORT_SPECS.map((spec) => (
            <div key={spec.label}>
              <dt className="text-xs text-zinc-500">{spec.label}</dt>
              <dd className="mt-1.5 font-mono text-sm font-medium tabular-nums text-zinc-100">
                {spec.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
