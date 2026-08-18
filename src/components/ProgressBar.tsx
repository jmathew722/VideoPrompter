import type { KeyboardEvent, MouseEvent } from 'react'
import { usePrompterStore } from '../store/prompterStore'

/** Reading progress, doubling as a scrub bar for jumping around the script. */
export function ProgressBar() {
  const progress = usePrompterStore((s) => s.progress)

  const seekToEvent = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0) return
    const fraction = (event.clientX - bounds.left) / bounds.width
    usePrompterStore.getState().controls?.seek(fraction)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') return // reserved for text size
    if (event.key === 'Home') {
      event.preventDefault()
      usePrompterStore.getState().controls?.seek(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      usePrompterStore.getState().controls?.seek(1)
    } else if (event.key === 'PageUp') {
      event.preventDefault()
      usePrompterStore.getState().controls?.seek(progress - step)
    } else if (event.key === 'PageDown') {
      event.preventDefault()
      usePrompterStore.getState().controls?.seek(progress + step)
    }
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onClick={seekToEvent}
      onKeyDown={handleKeyDown}
      className="group absolute inset-x-0 top-0 z-20 flex h-4 cursor-pointer items-start"
    >
      <div className="h-1 w-full bg-black/10 transition-[height] duration-150 group-hover:h-1.5 dark:bg-white/10">
        <div
          className="h-full bg-indigo-500 transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  )
}
