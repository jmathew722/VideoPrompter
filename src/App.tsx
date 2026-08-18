import { useEffect } from 'react'
import { PrompterView } from './components/PrompterView'
import { UploadScreen } from './components/UploadScreen'
import { usePictureInPicture } from './hooks/usePictureInPicture'
import { usePrompterStore } from './store/prompterStore'

export default function App() {
  const status = usePrompterStore((s) => s.status)
  const theme = usePrompterStore((s) => s.theme)
  const { pipWindow, supported: pipSupported, toggle: togglePip, close: closePip, syncTheme } =
    usePictureInPicture()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    syncTheme()
  }, [theme, syncTheme])

  // A floating window with no script in it would just be a blank rectangle.
  useEffect(() => {
    if (status !== 'ready' && pipWindow) closePip()
  }, [status, pipWindow, closePip])

  if (status !== 'ready') return <UploadScreen />

  return (
    <PrompterView
      // Remounting on pop-out rebinds the scroll engine to the new document.
      key={pipWindow ? 'floating' : 'page'}
      pipWindow={pipWindow}
      pipSupported={pipSupported}
      onTogglePip={togglePip}
    />
  )
}
