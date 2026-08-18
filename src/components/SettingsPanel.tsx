import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { LIMITS, usePrompterStore } from '../store/prompterStore'
import { SHORTCUTS } from '../hooks/useKeyboardShortcuts'
import { formatDuration } from '../lib/format'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{display}</span>
      </span>
      <input
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150',
          checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700',
        ].join(' ')}
      >
        <span
          // `left-0` is load-bearing: without it the knob starts from the
          // button's centred static position instead of the track's edge.
          className={[
            'absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-zinc-200 py-6 first:border-0 first:pt-0 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {title}
      </h3>
      {children}
    </section>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  /** The document the panel is rendered into — the page, or the floating window. */
  doc?: Document
}

/** Everything that shapes the read: pace, typography, mirroring and the countdown. */
export function SettingsPanel({ open, onClose, doc = document }: Props) {
  const state = usePrompterStore()
  const { setSetting } = state

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    doc.addEventListener('keydown', handler)
    return () => doc.removeEventListener('keydown', handler)
  }, [open, onClose, doc])

  const estimatedSeconds = state.wordCount > 0 ? (state.wordCount / state.wpm) * 60 : 0

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={[
          'absolute inset-0 z-40 bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      <aside
        aria-label="Prompter settings"
        aria-hidden={!open}
        className={[
          'absolute inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        ].join(' ')}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <Section title="Pace">
            <Slider
              label="Reading speed"
              value={state.wpm}
              min={LIMITS.wpm.min}
              max={LIMITS.wpm.max}
              step={LIMITS.wpm.step}
              display={`${state.wpm} wpm`}
              onChange={(value) => setSetting('wpm', value)}
            />
            {state.wordCount > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {state.wordCount.toLocaleString()} words — about{' '}
                {formatDuration(estimatedSeconds)} at this pace.
              </p>
            )}
            <Slider
              label="Countdown before start"
              value={state.countdownSeconds}
              min={LIMITS.countdown.min}
              max={LIMITS.countdown.max}
              step={LIMITS.countdown.step}
              display={state.countdownSeconds === 0 ? 'off' : `${state.countdownSeconds}s`}
              onChange={(value) => setSetting('countdownSeconds', value)}
            />
          </Section>

          <Section title="Type">
            <Slider
              label="Text size"
              value={state.fontSize}
              min={LIMITS.fontSize.min}
              max={LIMITS.fontSize.max}
              step={LIMITS.fontSize.step}
              display={`${state.fontSize}px`}
              onChange={(value) => setSetting('fontSize', value)}
            />
            <Slider
              label="Line spacing"
              value={state.lineHeight}
              min={LIMITS.lineHeight.min}
              max={LIMITS.lineHeight.max}
              step={LIMITS.lineHeight.step}
              display={state.lineHeight.toFixed(2)}
              onChange={(value) => setSetting('lineHeight', value)}
            />
            <Slider
              label="Reading width"
              value={state.readingWidth}
              min={LIMITS.readingWidth.min}
              max={LIMITS.readingWidth.max}
              step={LIMITS.readingWidth.step}
              display={`${state.readingWidth}px`}
              onChange={(value) => setSetting('readingWidth', value)}
            />
            <div>
              <span className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Typeface
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(['sans', 'serif'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setSetting('fontChoice', choice)}
                    aria-pressed={state.fontChoice === choice}
                    className={[
                      'rounded-lg border px-3 py-2 text-sm capitalize transition-colors duration-150',
                      state.fontChoice === choice
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                        : 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600',
                    ].join(' ')}
                    style={{
                      fontFamily:
                        choice === 'serif'
                          ? 'var(--font-reading-serif)'
                          : 'var(--font-reading-sans)',
                    }}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Display">
            <Toggle
              label="Dark theme"
              checked={state.theme === 'dark'}
              onChange={(checked) => setSetting('theme', checked ? 'dark' : 'light')}
            />
            <Toggle
              label="Eye-line marker"
              checked={state.showEyeLine}
              onChange={(checked) => setSetting('showEyeLine', checked)}
            />
            <Toggle
              label="Mirror horizontally"
              checked={state.mirrorX}
              onChange={(checked) => setSetting('mirrorX', checked)}
            />
            <Toggle
              label="Mirror vertically"
              checked={state.mirrorY}
              onChange={(checked) => setSetting('mirrorY', checked)}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Mirroring is for beam-splitter teleprompter rigs — leave it off for a
              plain screen.
            </p>
          </Section>

          <Section title="Keyboard">
            <dl className="space-y-2">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-center justify-between gap-4">
                  <dt className="text-sm text-zinc-600 dark:text-zinc-400">
                    {shortcut.description}
                  </dt>
                  <dd>
                    <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {shortcut.keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <button
            type="button"
            onClick={state.resetSettings}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 transition-colors duration-150 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset to defaults
          </button>
        </div>
      </aside>
    </>
  )
}
