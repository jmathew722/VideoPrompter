import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { usePrompterStore } from '../store/prompterStore'

/** Where the reading line sits, as a fraction of viewport height from the top. */
export const EYE_LINE = 0.33

interface Options {
  /** The clipping window the script scrolls inside. */
  viewportRef: RefObject<HTMLElement | null>
  /** The element that gets the translateY transform. */
  contentRef: RefObject<HTMLElement | null>
  /** Just the rendered script, excluding the lead-in/lead-out spacers. */
  textRef: RefObject<HTMLElement | null>
}

interface Metrics {
  contentHeight: number
  viewportHeight: number
  textHeight: number
  maxOffset: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * Frame-rate independent teleprompter scrolling.
 *
 * A `requestAnimationFrame` loop advances a numeric offset by
 * `pixelsPerSecond * deltaTime` and writes it straight to the DOM as a
 * `translate3d`, which the compositor can handle without a layout pass. Speed is
 * derived from words-per-minute and the measured pixel height of the script, so
 * every word gets the same amount of screen time no matter the window size, and
 * changing WPM mid-run takes effect on the very next frame.
 */
export function useAutoScroll({ viewportRef, contentRef, textRef }: Options) {
  const offsetRef = useRef(0)
  const metricsRef = useRef<Metrics>({
    contentHeight: 0,
    viewportHeight: 0,
    textHeight: 0,
    maxOffset: 0,
  })
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const lastPublishedRef = useRef(-1)

  const isPlaying = usePrompterStore((s) => s.isPlaying)

  const applyTransform = useCallback(() => {
    const content = contentRef.current
    if (content) {
      content.style.transform = `translate3d(0, ${-offsetRef.current}px, 0)`
    }
  }, [contentRef])

  const publishProgress = useCallback((force = false) => {
    const { maxOffset } = metricsRef.current
    const progress = maxOffset > 0 ? clamp(offsetRef.current / maxOffset, 0, 1) : 0
    // Throttle store writes so the progress bar re-renders far less than 60x/s.
    if (!force && Math.abs(progress - lastPublishedRef.current) < 0.002) return
    lastPublishedRef.current = progress
    usePrompterStore.getState().setProgress(progress, maxOffset > 0 && progress >= 0.999)
  }, [])

  const measure = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    const text = textRef.current
    if (!viewport || !content) return

    const previous = metricsRef.current
    const contentHeight = content.scrollHeight
    const viewportHeight = viewport.clientHeight
    const textHeight = text?.scrollHeight ?? contentHeight
    const maxOffset = Math.max(0, contentHeight - viewportHeight)

    if (previous.contentHeight === 0) {
      // First measurement. Popping out to a floating window remounts this tree,
      // so restore the reader's place from the progress already in the store.
      const { progress } = usePrompterStore.getState()
      offsetRef.current = clamp(progress * maxOffset, 0, maxOffset)
    } else if (contentHeight !== previous.contentHeight) {
      // Keep the reader on the same words when the layout reflows (font size,
      // column width, window resize).
      const fraction = offsetRef.current / previous.contentHeight
      offsetRef.current = clamp(fraction * contentHeight, 0, maxOffset)
    } else {
      offsetRef.current = clamp(offsetRef.current, 0, maxOffset)
    }

    metricsRef.current = { contentHeight, viewportHeight, textHeight, maxOffset }
    applyTransform()
    publishProgress(true)
  }, [applyTransform, contentRef, publishProgress, textRef, viewportRef])

  /** Pixels per second for the current WPM and script density. */
  const pixelsPerSecond = useCallback(() => {
    const { wpm, wordCount } = usePrompterStore.getState()
    const { textHeight } = metricsRef.current
    if (wordCount <= 0 || textHeight <= 0) return 0
    return (textHeight / wordCount) * (wpm / 60)
  }, [])

  // Re-measure whenever the script, the settings, or the window change shape.
  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    measure()

    const observer = new ResizeObserver(() => measure())
    observer.observe(viewport)
    observer.observe(content)
    if (textRef.current) observer.observe(textRef.current)

    const ownerWindow = viewport.ownerDocument.defaultView
    ownerWindow?.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      ownerWindow?.removeEventListener('resize', measure)
    }
  }, [measure, viewportRef, contentRef, textRef])

  // The scroll loop itself.
  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      lastTimeRef.current = null
      publishProgress(true)
      return
    }

    const step = (time: number) => {
      const previousTime = lastTimeRef.current ?? time
      lastTimeRef.current = time
      // Clamp so a backgrounded tab or a dropped frame cannot jump the script.
      const deltaSeconds = Math.min(time - previousTime, 100) / 1000

      const { maxOffset } = metricsRef.current
      offsetRef.current = Math.min(
        offsetRef.current + pixelsPerSecond() * deltaSeconds,
        maxOffset,
      )
      applyTransform()

      if (maxOffset > 0 && offsetRef.current >= maxOffset) {
        publishProgress(true)
        usePrompterStore.getState().pause()
        return
      }

      publishProgress()
      frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      lastTimeRef.current = null
    }
  }, [isPlaying, applyTransform, pixelsPerSecond, publishProgress])

  // Publish imperative controls so buttons, keys and the wheel can drive scrolling.
  useEffect(() => {
    const { registerControls } = usePrompterStore.getState()

    registerControls({
      reset: () => {
        offsetRef.current = 0
        applyTransform()
        publishProgress(true)
      },
      nudge: (deltaPx: number) => {
        offsetRef.current = clamp(offsetRef.current + deltaPx, 0, metricsRef.current.maxOffset)
        applyTransform()
        publishProgress(true)
      },
      seek: (fraction: number) => {
        offsetRef.current = clamp(fraction, 0, 1) * metricsRef.current.maxOffset
        applyTransform()
        publishProgress(true)
      },
    })

    return () => usePrompterStore.getState().registerControls(null)
  }, [applyTransform, publishProgress])
}
