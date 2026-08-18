import { useEffect } from 'react'
import { LIMITS, usePrompterStore } from '../store/prompterStore'

export interface Shortcut {
  keys: string
  description: string
}

/** Shown in the on-screen help so the list and the handler stay in step. */
export const SHORTCUTS: Shortcut[] = [
  { keys: 'Space', description: 'Play / pause' },
  { keys: '↑ / ↓', description: 'Speed up / slow down' },
  { keys: '← / →', description: 'Smaller / larger text' },
  { keys: 'R', description: 'Back to the top' },
  { keys: 'M', description: 'Mirror the text' },
  { keys: 'F', description: 'Fullscreen' },
  { keys: 'PgUp / PgDn', description: 'Jump back / forward' },
  { keys: 'Home / End', description: 'Start / end of script' },
]

interface Options {
  /** The document hosting the prompter — the page, or the floating window. */
  doc: Document
  onToggleFullscreen: () => void
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function useKeyboardShortcuts({ doc, onToggleFullscreen }: Options) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const store = usePrompterStore.getState()
      // Every shortcut except fullscreen needs a loaded script.
      const hasScript = store.status === 'ready'

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          if (!hasScript) return
          event.preventDefault()
          store.togglePlay()
          return

        case 'ArrowUp':
          if (!hasScript) return
          event.preventDefault()
          store.adjustWpm(LIMITS.wpm.step)
          return

        case 'ArrowDown':
          if (!hasScript) return
          event.preventDefault()
          store.adjustWpm(-LIMITS.wpm.step)
          return

        case 'ArrowRight':
        case ']':
          if (!hasScript) return
          event.preventDefault()
          store.adjustFontSize(LIMITS.fontSize.step)
          return

        case 'ArrowLeft':
        case '[':
          if (!hasScript) return
          event.preventDefault()
          store.adjustFontSize(-LIMITS.fontSize.step)
          return

        case '+':
        case '=':
          if (!hasScript) return
          store.adjustWpm(LIMITS.wpm.step)
          return

        case '-':
        case '_':
          if (!hasScript) return
          store.adjustWpm(-LIMITS.wpm.step)
          return

        case 'PageDown':
          if (!hasScript) return
          event.preventDefault()
          store.controls?.nudge(doc.defaultView ? doc.defaultView.innerHeight * 0.5 : 300)
          return

        case 'PageUp':
          if (!hasScript) return
          event.preventDefault()
          store.controls?.nudge(doc.defaultView ? -doc.defaultView.innerHeight * 0.5 : -300)
          return

        case 'Home':
          if (!hasScript) return
          event.preventDefault()
          store.restart()
          return

        case 'End':
          if (!hasScript) return
          event.preventDefault()
          store.pause()
          store.controls?.seek(1)
          return
      }

      switch (event.key.toLowerCase()) {
        case 'f':
          event.preventDefault()
          onToggleFullscreen()
          return
        case 'r':
          if (!hasScript) return
          event.preventDefault()
          store.restart()
          return
        case 'm':
          if (!hasScript) return
          event.preventDefault()
          store.toggleMirrorX()
      }
    }

    doc.addEventListener('keydown', handler)
    return () => doc.removeEventListener('keydown', handler)
  }, [doc, onToggleFullscreen])
}
