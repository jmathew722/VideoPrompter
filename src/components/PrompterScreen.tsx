import { useLayoutEffect, useState } from 'react'
import type { RefObject, WheelEvent } from 'react'
import { EYE_LINE } from '../hooks/useAutoScroll'
import { usePrompterStore } from '../store/prompterStore'

interface Props {
  viewportRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  textRef: RefObject<HTMLDivElement | null>
}

const FONT_STACKS = {
  sans: 'var(--font-reading-sans)',
  serif: 'var(--font-reading-serif)',
} as const

/**
 * The reading surface: a single column of script that the scroll engine slides
 * upward past a fixed eye-line near the top of the screen, so the reader's gaze
 * stays close to the camera.
 */
export function PrompterScreen({ viewportRef, contentRef, textRef }: Props) {
  const paragraphs = usePrompterStore((s) => s.paragraphs)
  const fontSize = usePrompterStore((s) => s.fontSize)
  const lineHeight = usePrompterStore((s) => s.lineHeight)
  const readingWidth = usePrompterStore((s) => s.readingWidth)
  const fontChoice = usePrompterStore((s) => s.fontChoice)
  const mirrorX = usePrompterStore((s) => s.mirrorX)
  const mirrorY = usePrompterStore((s) => s.mirrorY)
  const showEyeLine = usePrompterStore((s) => s.showEyeLine)

  // Measured rather than derived from viewport units so the lead-in and
  // lead-out spacers stay exact in fullscreen and in the floating window too.
  const [viewportHeight, setViewportHeight] = useState(0)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const sync = () => setViewportHeight(viewport.clientHeight)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewportRef])

  const mirrorTransform = [mirrorX && 'scaleX(-1)', mirrorY && 'scaleY(-1)']
    .filter(Boolean)
    .join(' ')

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    usePrompterStore.getState().controls?.nudge(event.deltaY)
  }

  return (
    <div
      ref={viewportRef}
      onWheel={handleWheel}
      className="no-scrollbar absolute inset-0 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{ transform: mirrorTransform || undefined }}
      >
        <div ref={contentRef} className="will-change-transform">
          {/* Lead-in: the first line starts level with the eye-line. */}
          <div style={{ height: viewportHeight * EYE_LINE }} aria-hidden="true" />

          <div
            ref={textRef}
            className="mx-auto px-[6vw] sm:px-10"
            style={{
              maxWidth: readingWidth,
              fontSize,
              lineHeight,
              fontFamily: FONT_STACKS[fontChoice],
            }}
          >
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="mb-[0.75em] last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>

          {/* Lead-out: the last line can still reach the eye-line. */}
          <div
            style={{ height: viewportHeight * (1 - EYE_LINE) }}
            aria-hidden="true"
          />
        </div>
      </div>

      {showEyeLine && (
        <div
          className="pointer-events-none absolute inset-x-0 flex items-center"
          style={{ top: viewportHeight * EYE_LINE }}
          aria-hidden="true"
        >
          <div className="h-0 w-0 border-y-8 border-l-[12px] border-y-transparent border-l-indigo-500/70" />
          <div className="h-px flex-1 bg-gradient-to-r from-indigo-500/50 via-indigo-500/20 to-indigo-500/50" />
          <div className="h-0 w-0 border-y-8 border-r-[12px] border-y-transparent border-r-indigo-500/70" />
        </div>
      )}
    </div>
  )
}
