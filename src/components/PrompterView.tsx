import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PictureInPicture2 } from 'lucide-react'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { useFullscreen } from '../hooks/useFullscreen'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { usePrompterStore } from '../store/prompterStore'
import { ControlBar } from './ControlBar'
import { Countdown } from './Countdown'
import { PrompterScreen } from './PrompterScreen'
import { ProgressBar } from './ProgressBar'
import { SettingsPanel } from './SettingsPanel'

const HIDE_CONTROLS_AFTER_MS = 2500

interface Props {
  pipWindow: Window | null
  pipSupported: boolean
  onTogglePip: () => void
}

/**
 * The reading experience: stage, transport, settings and the floating-window
 * portal. Remounted when the floating window opens or closes, which is what
 * lets the scroll engine re-bind to the new document's elements.
 */
export function PrompterView({ pipWindow, pipSupported, onTogglePip }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pointerIdle, setPointerIdle] = useState(false)

  const isPlaying = usePrompterStore((s) => s.isPlaying)

  const hostDoc = pipWindow?.document ?? document

  useAutoScroll({ viewportRef, contentRef, textRef })

  const {
    isFullscreen,
    toggle: toggleFullscreen,
    supported: fullscreenSupported,
  } = useFullscreen(stageRef)

  const onToggleFullscreen = useCallback(() => void toggleFullscreen(), [toggleFullscreen])
  useKeyboardShortcuts({ doc: hostDoc, onToggleFullscreen })

  // Fade the controls out of shot a moment into the read, and bring them back
  // on any movement.
  useEffect(() => {
    if (!isPlaying) {
      setPointerIdle(false)
      return
    }

    let timer = 0
    const wake = () => {
      setPointerIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setPointerIdle(true), HIDE_CONTROLS_AFTER_MS)
    }

    wake()
    hostDoc.addEventListener('mousemove', wake)
    hostDoc.addEventListener('touchstart', wake)
    hostDoc.addEventListener('keydown', wake)

    return () => {
      clearTimeout(timer)
      hostDoc.removeEventListener('mousemove', wake)
      hostDoc.removeEventListener('touchstart', wake)
      hostDoc.removeEventListener('keydown', wake)
    }
  }, [isPlaying, hostDoc])

  const controlsVisible = !pointerIdle || settingsOpen

  const stage = (
    <div
      ref={stageRef}
      className={[
        'prompter-stage relative h-full w-full overflow-hidden',
        controlsVisible ? '' : 'cursor-none',
      ].join(' ')}
    >
      <PrompterScreen
        viewportRef={viewportRef}
        contentRef={contentRef}
        textRef={textRef}
      />
      <ProgressBar />
      <Countdown />
      <ControlBar
        visible={controlsVisible}
        onOpenSettings={() => setSettingsOpen(true)}
        isFullscreen={isFullscreen}
        fullscreenSupported={fullscreenSupported}
        onToggleFullscreen={onToggleFullscreen}
        pipSupported={pipSupported}
        pipActive={pipWindow !== null}
        onTogglePip={onTogglePip}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        doc={hostDoc}
      />
    </div>
  )

  if (!pipWindow) return stage

  return (
    <>
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center">
        <PictureInPicture2 className="size-10 text-indigo-400" aria-hidden="true" />
        <div>
          <p className="text-lg font-medium text-zinc-100">
            Playing in the floating window
          </p>
          <p className="mt-1 max-w-sm text-sm text-zinc-400">
            Drag it over your call and read from there. Closing it brings the
            prompter back to this tab.
          </p>
        </div>
        <button
          type="button"
          onClick={onTogglePip}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-indigo-500"
        >
          Bring it back here
        </button>
      </div>
      {createPortal(stage, pipWindow.document.body)}
    </>
  )
}
