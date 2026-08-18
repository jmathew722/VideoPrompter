import type { ReactNode } from 'react'
import {
  FileUp,
  FlipHorizontal2,
  Maximize,
  Minimize,
  Minus,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sun,
  Moon,
  Type,
} from 'lucide-react'
import { LIMITS, usePrompterStore } from '../store/prompterStore'
import { formatDuration } from '../lib/format'

interface IconButtonProps {
  label: string
  onClick: () => void
  children: ReactNode
  active?: boolean
  disabled?: boolean
}

function IconButton({ label, onClick, children, active, disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={[
        'flex size-8 items-center justify-center rounded-lg transition-colors duration-150 disabled:opacity-40 sm:size-9',
        active
          ? 'bg-indigo-500/20 text-indigo-300'
          : 'text-zinc-300 hover:bg-white/10 hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
}

/**
 * Keeps the bar to a single row on phones. Everything hidden here is still
 * reachable from the settings panel, which is one tap away.
 */
function WideOnly({ children }: { children: ReactNode }) {
  return <span className="hidden sm:contents">{children}</span>
}

interface Props {
  visible: boolean
  onOpenSettings: () => void
  isFullscreen: boolean
  fullscreenSupported: boolean
  onToggleFullscreen: () => void
  pipSupported: boolean
  pipActive: boolean
  onTogglePip: () => void
}

/**
 * The floating transport. It fades out shortly after playback starts so it does
 * not sit in shot, and comes back on any mouse movement.
 */
export function ControlBar({
  visible,
  onOpenSettings,
  isFullscreen,
  fullscreenSupported,
  onToggleFullscreen,
  pipSupported,
  pipActive,
  onTogglePip,
}: Props) {
  const isPlaying = usePrompterStore((s) => s.isPlaying)
  const counting = usePrompterStore((s) => s.countdownValue !== null)
  const wpm = usePrompterStore((s) => s.wpm)
  const fontSize = usePrompterStore((s) => s.fontSize)
  const theme = usePrompterStore((s) => s.theme)
  const mirrorX = usePrompterStore((s) => s.mirrorX)
  const wordCount = usePrompterStore((s) => s.wordCount)
  const pageCount = usePrompterStore((s) => s.pageCount)
  const fileName = usePrompterStore((s) => s.fileName)
  const progress = usePrompterStore((s) => s.progress)

  const {
    togglePlay,
    restart,
    adjustWpm,
    adjustFontSize,
    toggleTheme,
    toggleMirrorX,
    clearDocument,
  } = usePrompterStore.getState()

  const totalSeconds = wordCount > 0 ? (wordCount / wpm) * 60 : 0
  const remaining = totalSeconds * (1 - progress)
  const running = isPlaying || counting

  return (
    <div
      className={[
        'absolute inset-x-0 bottom-0 z-30 flex justify-center p-4 transition-all duration-200',
        visible ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      ].join(' ')}
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-2xl border border-white/10 bg-zinc-900/85 px-2 py-2 sm:gap-1 sm:px-3 shadow-2xl backdrop-blur-md">
        <div className="mr-2 hidden min-w-0 flex-col pl-1 sm:flex">
          <span className="max-w-45 truncate text-xs font-medium text-zinc-200">
            {fileName ?? 'Script'}
          </span>
          <span className="text-[11px] tabular-nums text-zinc-500">
            {pageCount > 0 && `${pageCount} pages · `}
            {wordCount.toLocaleString()} words · {formatDuration(remaining)} left
          </span>
        </div>

        <IconButton label="Back to the top (R)" onClick={restart}>
          <RotateCcw className="size-4.5" aria-hidden="true" />
        </IconButton>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={running ? 'Pause (Space)' : 'Play (Space)'}
          title={running ? 'Pause (Space)' : 'Play (Space)'}
          className="mx-1 flex size-11 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-colors duration-150 hover:bg-indigo-500 active:bg-indigo-700"
        >
          {running ? (
            <Pause className="size-5 fill-current" aria-hidden="true" />
          ) : (
            <Play className="size-5 translate-x-px fill-current" aria-hidden="true" />
          )}
        </button>

        <Divider />

        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label="Reading speed"
        >
          <IconButton
            label="Slower"
            onClick={() => adjustWpm(-LIMITS.wpm.step)}
            disabled={wpm <= LIMITS.wpm.min}
          >
            <Minus className="size-4" aria-hidden="true" />
          </IconButton>
          <span className="w-14 text-center text-xs tabular-nums text-zinc-300 sm:w-16">
            {wpm} wpm
          </span>
          <IconButton
            label="Faster"
            onClick={() => adjustWpm(LIMITS.wpm.step)}
            disabled={wpm >= LIMITS.wpm.max}
          >
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        <WideOnly>
          <Divider />

          <div className="flex items-center gap-0.5" role="group" aria-label="Text size">
            <IconButton
              label="Smaller text"
              onClick={() => adjustFontSize(-LIMITS.fontSize.step)}
              disabled={fontSize <= LIMITS.fontSize.min}
            >
              <Type className="size-3.5" aria-hidden="true" />
            </IconButton>
            <span className="w-10 text-center text-xs tabular-nums text-zinc-300">
              {fontSize}
            </span>
            <IconButton
              label="Larger text"
              onClick={() => adjustFontSize(LIMITS.fontSize.step)}
              disabled={fontSize >= LIMITS.fontSize.max}
            >
              <Type className="size-5" aria-hidden="true" />
            </IconButton>
          </div>

          <Divider />

          <IconButton label="Mirror (M)" onClick={toggleMirrorX} active={mirrorX}>
            <FlipHorizontal2 className="size-4.5" aria-hidden="true" />
          </IconButton>

          <IconButton
            label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <Sun className="size-4.5" aria-hidden="true" />
            ) : (
              <Moon className="size-4.5" aria-hidden="true" />
            )}
          </IconButton>
        </WideOnly>

        {fullscreenSupported && (
          <IconButton
            label={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            onClick={onToggleFullscreen}
            active={isFullscreen}
          >
            {isFullscreen ? (
              <Minimize className="size-4.5" aria-hidden="true" />
            ) : (
              <Maximize className="size-4.5" aria-hidden="true" />
            )}
          </IconButton>
        )}

        {pipSupported && (
          <IconButton
            label={pipActive ? 'Close floating window' : 'Pop out (floating window)'}
            onClick={onTogglePip}
            active={pipActive}
          >
            <PictureInPicture2 className="size-4.5" aria-hidden="true" />
          </IconButton>
        )}

        <IconButton label="Settings" onClick={onOpenSettings}>
          <Settings2 className="size-4.5" aria-hidden="true" />
        </IconButton>

        <Divider />

        <IconButton label="Open a different PDF" onClick={clearDocument}>
          <FileUp className="size-4.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}
