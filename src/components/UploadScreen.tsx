import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import type { FileRejection } from 'react-dropzone'
import { FileUp, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { usePrompterStore } from '../store/prompterStore'

const MAX_BYTES = 100 * 1024 * 1024

function describeRejection(rejection: FileRejection | undefined): string {
  const code = rejection?.errors[0]?.code
  if (code === 'file-invalid-type') return 'That file is not a PDF. Please choose a .pdf file.'
  if (code === 'too-many-files') return 'One PDF at a time, please.'
  if (code === 'file-too-large') return 'That PDF is larger than 100 MB.'
  return rejection?.errors[0]?.message ?? 'That file could not be used.'
}

export function UploadScreen() {
  const status = usePrompterStore((s) => s.status)
  const error = usePrompterStore((s) => s.error)
  const fileName = usePrompterStore((s) => s.fileName)
  const extractProgress = usePrompterStore((s) => s.extractProgress)

  const isExtracting = status === 'extracting'

  const handleFile = useCallback(async (file: File) => {
    const store = usePrompterStore.getState()
    store.startExtraction(file.name)
    try {
      // PDF.js is a large dependency and is only needed once a file arrives,
      // so it is loaded on demand rather than in the initial bundle.
      const { extractPdfText, PdfExtractError } = await import('../lib/pdfExtract')
      try {
        const result = await extractPdfText(file, (fraction) =>
          usePrompterStore.getState().setExtractProgress(fraction),
        )
        store.loadDocument({ fileName: file.name, ...result })
      } catch (cause) {
        store.failExtraction(
          cause instanceof PdfExtractError
            ? cause.message
            : 'Something went wrong while reading that PDF.',
        )
      }
    } catch {
      store.failExtraction('Could not load the PDF reader. Check your connection and reload.')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    multiple: false,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    noClick: true,
    noKeyboard: true,
    disabled: isExtracting,
    onDropAccepted: (files) => {
      if (files[0]) void handleFile(files[0])
    },
    onDropRejected: (rejections) =>
      usePrompterStore.getState().failExtraction(describeRejection(rejections[0])),
  })

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-xl">
        <header className="mb-10 text-center">
          <h1 className="bg-gradient-to-br from-zinc-900 to-zinc-500 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl dark:from-white dark:to-zinc-400">
            PDF Teleprompter
          </h1>
          <p className="mx-auto mt-3 max-w-md text-balance text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Drop in a script and read it aloud at your own pace — smooth scrolling,
            a floating window for video calls, and nothing to install.
          </p>
        </header>

        <div
          {...getRootProps()}
          className={[
            'group relative overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-colors duration-200',
            isDragReject
              ? 'border-red-400 bg-red-50 dark:border-red-500/60 dark:bg-red-950/30'
              : isDragActive
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                : 'border-zinc-300 bg-white hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-indigo-500/70',
          ].join(' ')}
        >
          <input {...getInputProps()} />

          {isExtracting ? (
            <div className="flex flex-col items-center gap-4">
              <LoaderCircle
                className="size-10 animate-spin text-indigo-500"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Reading {fileName}
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {Math.round(extractProgress * 100)}% — extracting text in your browser
                </p>
              </div>
              <div
                className="h-1.5 w-56 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                role="progressbar"
                aria-valuenow={Math.round(extractProgress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Extraction progress"
              >
                <div
                  className="h-full rounded-full bg-indigo-500 transition-[width] duration-200"
                  style={{ width: `${Math.max(extractProgress * 100, 4)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <div className="flex size-14 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 transition-transform duration-200 group-hover:scale-105">
                <FileUp className="size-7" aria-hidden="true" />
              </div>
              <div>
                <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                  {isDragActive ? 'Drop your PDF here' : 'Drag a PDF here'}
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Multi-page and multi-column documents are fine.
                </p>
              </div>
              <button
                type="button"
                onClick={open}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 active:bg-indigo-700"
              >
                Choose a PDF
              </button>
            </div>
          )}
        </div>

        {status === 'error' && error && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-left dark:border-red-900/60 dark:bg-red-950/40"
          >
            <TriangleAlert
              className="mt-0.5 size-5 shrink-0 text-red-500"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Could not use that file
              </p>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </div>
        )}

        <p className="mt-8 flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Your PDF is read on this device and never uploaded anywhere.
        </p>
      </div>
    </div>
  )
}
