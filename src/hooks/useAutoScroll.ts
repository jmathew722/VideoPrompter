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

/**
 * Where each paragraph sits and how many words it holds, which is what lets a
 * pixel position be converted to a word position and back.
 *
 * Each paragraph owns the vertical space down to the start of the next one, so
 * the gaps between paragraphs belong to the paragraph above and the map tiles
 * the script without holes. That keeps the mapping continuous: the scroll
 * changes rate at a paragraph boundary but never jumps.
 */
interface WordMap {
  tops: number[]
  spans: number[]
  counts: number[]
  /** Words lying above the start of each paragraph. */
  cumulative: number[]
  totalWords: number
}

const EMPTY_MAP: WordMap = {
  tops: [],
  spans: [],
  counts: [],
  cumulative: [],
  totalWords: 0,
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const countWords = (text: string): number => (text.trim().match(/\S+/g) ?? []).length

/** Index of the last entry whose value is at or below `target`. */
function lastAtOrBelow(values: number[], target: number): number {
  let low = 0
  let high = values.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (values[mid] <= target) low = mid
    else high = mid - 1
  }
  return low
}

/** Pixel offset at which `words` of the script have passed the eye-line. */
function yForWords(map: WordMap, words: number): number {
  if (map.totalWords <= 0) return 0
  const target = clamp(words, 0, map.totalWords)
  const i = lastAtOrBelow(map.cumulative, target)
  if (map.counts[i] <= 0) return map.tops[i]
  const within = (target - map.cumulative[i]) / map.counts[i]
  return map.tops[i] + within * map.spans[i]
}

/** How many words have passed the eye-line at a given pixel offset. */
function wordsForY(map: WordMap, y: number): number {
  if (map.totalWords <= 0) return 0
  const i = lastAtOrBelow(map.tops, y)
  if (map.spans[i] <= 0) return map.cumulative[i]
  const within = clamp((y - map.tops[i]) / map.spans[i], 0, 1)
  return map.cumulative[i] + within * map.counts[i]
}

/**
 * Frame-rate independent teleprompter scrolling at a true words-per-minute.
 *
 * A `requestAnimationFrame` loop advances how many words have been read by
 * `wpm / 60 * deltaTime`, then converts that to a pixel offset through a map of
 * the rendered paragraphs and writes it as a `translate3d`, which the
 * compositor handles without a layout pass.
 *
 * Integrating words rather than pixels is what keeps the pace honest. A single
 * pixels-per-second figure for the whole script assumes words are spread evenly
 * down the page, but a three-word heading fills a line just as a dozen words of
 * prose do, so a constant pixel speed races through dense paragraphs and crawls
 * through sparse ones. Driving the word count instead makes the rate crossing
 * the eye-line match the selected WPM everywhere, not just on average.
 *
 * Word position also survives reflow: changing the font size or column width
 * keeps the reader on the same word rather than the same fraction of the page.
 */
export function useAutoScroll({ viewportRef, contentRef, textRef }: Options) {
  const offsetRef = useRef(0)
  /** The reader's place, and the value the scroll loop actually advances. */
  const wordsReadRef = useRef(0)
  const mapRef = useRef<WordMap>(EMPTY_MAP)
  const metricsRef = useRef<Metrics>({
    contentHeight: 0,
    viewportHeight: 0,
    textHeight: 0,
    maxOffset: 0,
  })
  const frameRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const lastPublishedRef = useRef(-1)
  const countsCacheRef = useRef<{ source: string[]; counts: number[] } | null>(null)

  const isPlaying = usePrompterStore((s) => s.isPlaying)

  const applyTransform = useCallback(() => {
    const content = contentRef.current
    if (content) {
      content.style.transform = `translate3d(0, ${-offsetRef.current}px, 0)`
    }
  }, [contentRef])

  const publishProgress = useCallback((force = false) => {
    const { totalWords } = mapRef.current
    const progress = totalWords > 0 ? clamp(wordsReadRef.current / totalWords, 0, 1) : 0
    // Throttle store writes so the progress bar re-renders far less than 60x/s.
    if (!force && Math.abs(progress - lastPublishedRef.current) < 0.002) return
    lastPublishedRef.current = progress
    usePrompterStore.getState().setProgress(progress, totalWords > 0 && progress >= 0.999)
  }, [])

  /** Word counts per paragraph, recomputed only when the script changes. */
  const paragraphWordCounts = useCallback((paragraphs: string[]): number[] => {
    const cached = countsCacheRef.current
    if (cached && cached.source === paragraphs) return cached.counts
    const counts = paragraphs.map(countWords)
    countsCacheRef.current = { source: paragraphs, counts }
    return counts
  }, [])

  const buildWordMap = useCallback(
    (text: HTMLElement | null, textHeight: number): WordMap => {
      if (!text) return EMPTY_MAP

      const counts = paragraphWordCounts(usePrompterStore.getState().paragraphs)
      const elements = Array.from(text.children) as HTMLElement[]
      const length = Math.min(elements.length, counts.length)
      if (length === 0) return EMPTY_MAP

      // offsetTop rather than getBoundingClientRect: the scroll transform and
      // mirror mode both sit on ancestors, and layout offsets ignore them.
      const base = text.offsetTop
      const tops: number[] = []
      for (let i = 0; i < length; i++) tops.push(elements[i].offsetTop - base)

      const spans: number[] = []
      const cumulative: number[] = []
      let running = 0
      for (let i = 0; i < length; i++) {
        spans.push((i + 1 < length ? tops[i + 1] : textHeight) - tops[i])
        cumulative.push(running)
        running += counts[i]
      }

      return { tops, spans, counts: counts.slice(0, length), cumulative, totalWords: running }
    },
    [paragraphWordCounts],
  )

  const measure = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    const text = textRef.current
    if (!viewport || !content) return

    const first = metricsRef.current.contentHeight === 0
    const contentHeight = content.scrollHeight
    const viewportHeight = viewport.clientHeight
    const textHeight = text?.scrollHeight ?? contentHeight
    const maxOffset = Math.max(0, contentHeight - viewportHeight)

    metricsRef.current = { contentHeight, viewportHeight, textHeight, maxOffset }
    mapRef.current = buildWordMap(text, textHeight)

    if (first) {
      // Popping out to a floating window remounts this tree, so pick the
      // reader's place back up from the progress already in the store.
      const { progress } = usePrompterStore.getState()
      wordsReadRef.current = progress * mapRef.current.totalWords
    }

    // Word position is the invariant across a reflow — same word, new geometry.
    offsetRef.current = clamp(yForWords(mapRef.current, wordsReadRef.current), 0, maxOffset)
    applyTransform()
    publishProgress(true)
  }, [applyTransform, buildWordMap, contentRef, publishProgress, textRef, viewportRef])

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

      const map = mapRef.current
      const { maxOffset } = metricsRef.current
      const { wpm } = usePrompterStore.getState()

      wordsReadRef.current = Math.min(
        wordsReadRef.current + (wpm / 60) * deltaSeconds,
        map.totalWords,
      )
      offsetRef.current = clamp(yForWords(map, wordsReadRef.current), 0, maxOffset)
      applyTransform()

      if (map.totalWords > 0 && wordsReadRef.current >= map.totalWords) {
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
  }, [isPlaying, applyTransform, publishProgress])

  // Publish imperative controls so buttons, keys and the wheel can drive scrolling.
  useEffect(() => {
    const { registerControls } = usePrompterStore.getState()

    const settle = () => {
      applyTransform()
      publishProgress(true)
    }

    registerControls({
      reset: () => {
        wordsReadRef.current = 0
        offsetRef.current = 0
        settle()
      },
      // Dragging and the wheel work in pixels, so read the word position back
      // out of where they landed.
      nudge: (deltaPx: number) => {
        offsetRef.current = clamp(offsetRef.current + deltaPx, 0, metricsRef.current.maxOffset)
        wordsReadRef.current = wordsForY(mapRef.current, offsetRef.current)
        settle()
      },
      seek: (fraction: number) => {
        wordsReadRef.current = clamp(fraction, 0, 1) * mapRef.current.totalWords
        offsetRef.current = clamp(
          yForWords(mapRef.current, wordsReadRef.current),
          0,
          metricsRef.current.maxOffset,
        )
        settle()
      },
    })

    return () => usePrompterStore.getState().registerControls(null)
  }, [applyTransform, publishProgress])
}
