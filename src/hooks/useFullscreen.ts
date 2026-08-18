import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Fullscreen for a single element, tracking state from the browser rather than
 * from our own calls so pressing Escape keeps the button label honest.
 */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const doc = targetRef.current?.ownerDocument ?? document
    const sync = () => setIsFullscreen(Boolean(doc.fullscreenElement))
    sync()
    doc.addEventListener('fullscreenchange', sync)
    return () => doc.removeEventListener('fullscreenchange', sync)
  }, [targetRef])

  const toggle = useCallback(async () => {
    const element = targetRef.current
    if (!element) return
    const doc = element.ownerDocument

    try {
      if (doc.fullscreenElement) await doc.exitFullscreen()
      else await element.requestFullscreen()
    } catch {
      // Rejected when there is no user gesture, or when a floating window is
      // in play. Nothing useful to recover, and the UI state stays correct.
    }
  }, [targetRef])

  const supported =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)

  return { isFullscreen, toggle, supported }
}
