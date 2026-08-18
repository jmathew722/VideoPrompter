import { useEffect } from 'react'
import { usePrompterStore } from '../store/prompterStore'

/**
 * The 3-2-1 overlay between pressing play and the script starting to move,
 * giving the reader time to settle and look at the camera.
 */
export function Countdown() {
  const value = usePrompterStore((s) => s.countdownValue)
  const tickCountdown = usePrompterStore((s) => s.tickCountdown)

  useEffect(() => {
    if (value === null) return
    const timer = setTimeout(tickCountdown, 1000)
    return () => clearTimeout(timer)
  }, [value, tickCountdown])

  if (value === null) return null

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
      role="status"
      aria-live="assertive"
      aria-label={`Starting in ${value}`}
    >
      <div
        key={value}
        className="flex size-32 animate-[ping_1s_ease-out_1] items-center justify-center rounded-full border-2 border-indigo-400/40"
        aria-hidden="true"
      />
      <div className="absolute text-8xl font-light tabular-nums text-white">{value}</div>
      <p className="absolute bottom-1/3 translate-y-24 text-sm uppercase tracking-[0.3em] text-white/60">
        Get ready
      </p>
    </div>
  )
}
