// Copies PDF.js's character maps into `public/` so they are served from this
// app rather than fetched from a CDN. Without them, PDFs that use one of the
// predefined Adobe CMaps (most CJK documents) extract as empty text.
//
// Runs automatically before `dev` and `build`; the copied files are generated
// output and stay out of version control.
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const assets = [
  { from: 'node_modules/pdfjs-dist/cmaps', to: 'public/cmaps' },
]

const exists = async (path) => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

for (const asset of assets) {
  const source = resolve(root, asset.from)
  const target = resolve(root, asset.to)

  if (!(await exists(source))) {
    console.warn(`[copy-pdf-assets] skipped, not found: ${asset.from}`)
    continue
  }

  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { recursive: true })
  console.log(`[copy-pdf-assets] ${asset.from} -> ${asset.to}`)
}
