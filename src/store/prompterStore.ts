import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

export type Theme = 'dark' | 'light'
export type FontChoice = 'sans' | 'serif'
export type DocStatus = 'idle' | 'extracting' | 'ready' | 'error'

/** Imperative handles published by the scroll engine so any component can drive it. */
export interface ScrollControls {
  /** Jump back to the very top of the script. */
  reset: () => void
  /** Move by a pixel delta (positive scrolls further into the script). */
  nudge: (deltaPx: number) => void
  /** Seek to a fraction (0–1) of the total scroll distance. */
  seek: (fraction: number) => void
}

export const LIMITS = {
  wpm: { min: 60, max: 1000, step: 5, default: 140 },
  fontSize: { min: 24, max: 120, step: 2, default: 48 },
  lineHeight: { min: 1.1, max: 2.4, step: 0.05, default: 1.5 },
  readingWidth: { min: 480, max: 1600, step: 20, default: 900 },
  countdown: { min: 0, max: 10, step: 1, default: 3 },
} as const

interface Settings {
  wpm: number
  fontSize: number
  lineHeight: number
  /** Max width of the reading column, in px. */
  readingWidth: number
  theme: Theme
  fontChoice: FontChoice
  mirrorX: boolean
  mirrorY: boolean
  /** Seconds of 3-2-1 countdown before scrolling starts; 0 disables it. */
  countdownSeconds: number
  showEyeLine: boolean
}

interface DocumentState {
  fileName: string | null
  paragraphs: string[]
  text: string
  wordCount: number
  pageCount: number
  status: DocStatus
  error: string | null
  /** 0–1 progress while a PDF is being parsed. */
  extractProgress: number
}

interface PlaybackState {
  isPlaying: boolean
  /** Remaining countdown ticks, or null when no countdown is running. */
  countdownValue: number | null
  /** 0–1 reading progress, published by the scroll engine (throttled). */
  progress: number
  atEnd: boolean
  controls: ScrollControls | null
}

interface Actions {
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  adjustWpm: (delta: number) => void
  adjustFontSize: (delta: number) => void
  toggleTheme: () => void
  toggleMirrorX: () => void
  resetSettings: () => void

  startExtraction: (fileName: string) => void
  setExtractProgress: (progress: number) => void
  loadDocument: (doc: {
    fileName: string
    text: string
    paragraphs: string[]
    wordCount: number
    pageCount: number
  }) => void
  failExtraction: (message: string) => void
  clearDocument: () => void

  play: () => void
  pause: () => void
  togglePlay: () => void
  tickCountdown: () => void
  cancelCountdown: () => void
  setProgress: (progress: number, atEnd: boolean) => void
  restart: () => void
  registerControls: (controls: ScrollControls | null) => void
}

export type PrompterState = Settings & DocumentState & PlaybackState & Actions

/**
 * A 48px script is right on a laptop but leaves only a few words per line on a
 * phone, so the starting size follows the screen. Only the default moves — once
 * the reader picks a size it is theirs, and it persists.
 */
function defaultFontSize(): number {
  if (typeof window === 'undefined') return LIMITS.fontSize.default
  const width = window.innerWidth
  if (width < 640) return 30
  if (width < 1024) return 40
  return LIMITS.fontSize.default
}

const defaultSettings: Settings = {
  wpm: LIMITS.wpm.default,
  fontSize: defaultFontSize(),
  lineHeight: LIMITS.lineHeight.default,
  readingWidth: LIMITS.readingWidth.default,
  theme: 'dark',
  fontChoice: 'sans',
  mirrorX: false,
  mirrorY: false,
  countdownSeconds: LIMITS.countdown.default,
  showEyeLine: true,
}

const emptyDocument: DocumentState = {
  fileName: null,
  paragraphs: [],
  text: '',
  wordCount: 0,
  pageCount: 0,
  status: 'idle',
  error: null,
  extractProgress: 0,
}

const idlePlayback = {
  isPlaying: false,
  countdownValue: null,
  progress: 0,
  atEnd: false,
} satisfies Omit<PlaybackState, 'controls'>

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/** Rounds to a step's precision so float drift never leaks into the UI. */
const snap = (value: number, step: number) =>
  Math.round(value / step) * step

/**
 * Storage that can never break the app.
 *
 * `localStorage` is not always writable: private browsing, a full quota, and
 * sandboxed or partitioned frames can all make `setItem` throw even when
 * reading works. Persist middleware writes during the state update, so an
 * exception there propagates out of every `set()` — the symptom is that
 * nothing responds at all, because changing any setting throws before the
 * store updates.
 *
 * Saving preferences is a convenience, so it degrades instead: writes are
 * probed once up front, every operation is guarded, and an in-memory map backs
 * the session so settings still work even when nothing can be written to disk.
 */
function createSafeStorage(): StateStorage {
  const memory = new Map<string, string>()

  const backing = (() => {
    if (typeof window === 'undefined') return null
    try {
      const probe = '__prompter_storage_probe__'
      window.localStorage.setItem(probe, probe)
      window.localStorage.removeItem(probe)
      return window.localStorage
    } catch {
      return null
    }
  })()

  return {
    getItem: (name) => {
      try {
        const stored = backing?.getItem(name)
        if (stored != null) return stored
      } catch {
        // fall through to whatever this session has in memory
      }
      return memory.get(name) ?? null
    },
    setItem: (name, value) => {
      memory.set(name, value)
      try {
        backing?.setItem(name, value)
      } catch {
        // Preferences stay in memory for this session; not worth surfacing.
      }
    },
    removeItem: (name) => {
      memory.delete(name)
      try {
        backing?.removeItem(name)
      } catch {
        // nothing to recover
      }
    },
  }
}

export const usePrompterStore = create<PrompterState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      ...emptyDocument,
      ...idlePlayback,
      controls: null,

      setSetting: (key, value) => set({ [key]: value } as Pick<Settings, typeof key>),

      adjustWpm: (delta) =>
        set((s) => ({
          wpm: clamp(snap(s.wpm + delta, LIMITS.wpm.step), LIMITS.wpm.min, LIMITS.wpm.max),
        })),

      adjustFontSize: (delta) =>
        set((s) => ({
          fontSize: clamp(
            snap(s.fontSize + delta, LIMITS.fontSize.step),
            LIMITS.fontSize.min,
            LIMITS.fontSize.max,
          ),
        })),

      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleMirrorX: () => set((s) => ({ mirrorX: !s.mirrorX })),
      resetSettings: () => set({ ...defaultSettings }),

      startExtraction: (fileName) =>
        set({
          ...emptyDocument,
          ...idlePlayback,
          fileName,
          status: 'extracting',
        }),

      setExtractProgress: (extractProgress) => set({ extractProgress }),

      loadDocument: (doc) =>
        set({
          ...idlePlayback,
          fileName: doc.fileName,
          text: doc.text,
          paragraphs: doc.paragraphs,
          wordCount: doc.wordCount,
          pageCount: doc.pageCount,
          status: 'ready',
          error: null,
          extractProgress: 1,
        }),

      failExtraction: (message) =>
        set({ ...emptyDocument, status: 'error', error: message }),

      clearDocument: () => set({ ...emptyDocument, ...idlePlayback }),

      play: () => {
        const { status, countdownSeconds, atEnd, controls } = get()
        if (status !== 'ready') return
        // Pressing play at the end of the script restarts from the top.
        if (atEnd) {
          controls?.reset()
          set({ atEnd: false, progress: 0 })
        }
        if (countdownSeconds > 0) {
          set({ countdownValue: countdownSeconds, isPlaying: false })
        } else {
          set({ countdownValue: null, isPlaying: true })
        }
      },

      pause: () => set({ isPlaying: false, countdownValue: null }),

      togglePlay: () => {
        const { isPlaying, countdownValue } = get()
        if (isPlaying || countdownValue !== null) get().pause()
        else get().play()
      },

      tickCountdown: () =>
        set((s) => {
          if (s.countdownValue === null) return s
          const next = s.countdownValue - 1
          return next <= 0
            ? { countdownValue: null, isPlaying: true }
            : { countdownValue: next }
        }),

      cancelCountdown: () => set({ countdownValue: null }),

      setProgress: (progress, atEnd) => set({ progress, atEnd }),

      restart: () => {
        get().controls?.reset()
        set({ isPlaying: false, countdownValue: null, progress: 0, atEnd: false })
      },

      registerControls: (controls) => set({ controls }),
    }),
    {
      name: 'pdf-teleprompter-settings',
      version: 1,
      storage: createJSONStorage(createSafeStorage),
      // Only user preferences survive a reload — never the document or playback state.
      partialize: (s): Settings => ({
        wpm: s.wpm,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        readingWidth: s.readingWidth,
        theme: s.theme,
        fontChoice: s.fontChoice,
        mirrorX: s.mirrorX,
        mirrorY: s.mirrorY,
        countdownSeconds: s.countdownSeconds,
        showEyeLine: s.showEyeLine,
      }),
    },
  ),
)
