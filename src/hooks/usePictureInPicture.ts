import { useCallback, useEffect, useRef, useState } from 'react'

// The Document Picture-in-Picture API is not in TypeScript's DOM library yet.
declare global {
  interface DocumentPictureInPictureOptions {
    width?: number
    height?: number
    disallowReturnToOpener?: boolean
    preferInitialWindowPlacement?: boolean
  }

  interface DocumentPictureInPicture extends EventTarget {
    readonly window: Window | null
    requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>
  }

  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

/**
 * Copies the page's styles into another document.
 *
 * A picture-in-picture window starts out completely unstyled, so every rule the
 * prompter depends on has to be carried across. Same-origin sheets are inlined
 * rule by rule (this is how Vite's injected `<style>` tags in dev arrive);
 * anything that throws on `cssRules` is cross-origin and gets re-linked by href.
 */
function copyStyles(target: Window) {
  const sheets = document.styleSheets

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]
    try {
      const rules = sheet.cssRules
      let css = ''
      for (let r = 0; r < rules.length; r++) css += rules[r].cssText + '\n'
      const style = target.document.createElement('style')
      style.textContent = css
      target.document.head.appendChild(style)
    } catch {
      if (!sheet.href) continue
      const link = target.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      target.document.head.appendChild(link)
    }
  }
}

/**
 * Pops the prompter into an always-on-top floating window so it can sit over a
 * video call. Chromium-only; callers should hide the entry point when
 * `supported` is false and fall back to fullscreen or a second browser window.
 */
export function usePictureInPicture() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [supported] = useState(
    () => typeof window !== 'undefined' && 'documentPictureInPicture' in window,
  )
  const pipRef = useRef<Window | null>(null)

  const open = useCallback(async () => {
    if (!supported || pipRef.current) return
    try {
      const pip = await window.documentPictureInPicture!.requestWindow({
        width: 520,
        height: 680,
      })

      copyStyles(pip)
      pip.document.title = 'Teleprompter'
      // Mirror the theme class so the floating window matches the page.
      pip.document.documentElement.className = document.documentElement.className
      pip.document.body.style.margin = '0'
      pip.document.body.style.height = '100%'
      pip.document.documentElement.style.height = '100%'

      pip.addEventListener('pagehide', () => {
        pipRef.current = null
        setPipWindow(null)
      })

      pipRef.current = pip
      setPipWindow(pip)
    } catch {
      // The request can be refused without a user gesture, or when another PiP
      // window already exists. Leaving state untouched keeps the button usable.
    }
  }, [supported])

  const close = useCallback(() => {
    pipRef.current?.close()
    pipRef.current = null
    setPipWindow(null)
  }, [])

  const toggle = useCallback(() => {
    if (pipRef.current) close()
    else void open()
  }, [close, open])

  // Never leave an orphaned floating window behind.
  useEffect(() => () => pipRef.current?.close(), [])

  /** Keeps the floating window's theme class in sync with the page. */
  const syncTheme = useCallback(() => {
    if (pipRef.current) {
      pipRef.current.document.documentElement.className =
        document.documentElement.className
    }
  }, [])

  return { pipWindow, supported, open, close, toggle, syncTheme }
}
