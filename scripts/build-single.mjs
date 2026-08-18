/**
 * Builds the whole app into one self-contained HTML file.
 *
 * The result has no sibling assets and needs no server: open it from disk, or
 * host it anywhere that can only serve a single page. Useful for handing the
 * prompter to someone who just wants to use it.
 *
 * Two things differ from the normal build:
 *  - the PDF.js worker is inlined as source and started from a blob URL rather
 *    than emitted as a separate .mjs file fetched over HTTP;
 *  - dynamic imports are flattened and CSS is inlined, so the page is a single
 *    <script> and a single <style>.
 *
 * Trade-off: the CMap files are left out, so PDFs that rely on a predefined
 * Adobe CMap (most CJK documents) will not extract. Use the normal build for
 * those.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'dist-single')
const workerPath = resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')

/**
 * Replaces the worker's `?url` import with a blob URL built from inlined
 * source, so nothing has to be fetched at runtime.
 */
const inlinePdfWorker = {
  name: 'inline-pdf-worker',
  enforce: 'pre',
  resolveId(id) {
    return id.includes('pdf.worker') && id.endsWith('?url') ? '\0inline-pdf-worker' : null
  },
  async load(id) {
    if (id !== '\0inline-pdf-worker') return null
    const source = await readFile(workerPath, 'utf8')
    return [
      `const source = ${JSON.stringify(source)}`,
      `const blob = new Blob([source], { type: 'text/javascript' })`,
      `export default URL.createObjectURL(blob)`,
    ].join('\n')
  },
}

await build({
  root,
  configFile: false,
  base: './',
  plugins: [react(), tailwindcss(), inlinePdfWorker],
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  logLevel: 'warn',
})

const built = await readFile(resolve(outDir, 'index.html'), 'utf8')

const scriptSrc = /<script[^>]*src="([^"]+)"[^>]*>\s*<\/script>/.exec(built)?.[1]
const styleHref = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/.exec(built)?.[1]
if (!scriptSrc || !styleHref) {
  throw new Error('could not find the built script/stylesheet references in index.html')
}

const assetPath = (href) => resolve(outDir, href.replace(/^\.?\//, ''))
const js = await readFile(assetPath(scriptSrc), 'utf8')
const css = await readFile(assetPath(styleHref), 'utf8')
const favicon = await readFile(resolve(root, 'public/favicon.svg'), 'utf8')

// A literal </script> or <!-- inside the bundle would close the tag early.
const escapeForScript = (code) =>
  code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')

const page = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#050506" />
    <link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}" />
    <title>PDF Teleprompter</title>
    <script>
      // Apply the saved theme before first paint so there is no flash.
      try {
        var saved = localStorage.getItem('pdf-teleprompter-settings')
        var theme = saved ? JSON.parse(saved).state.theme : 'dark'
        document.documentElement.classList.toggle('dark', theme !== 'light')
      } catch (error) {
        document.documentElement.classList.add('dark')
      }
    </script>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
${escapeForScript(js)}
    </script>
  </body>
</html>
`

await mkdir(outDir, { recursive: true })
const target = resolve(outDir, 'pdf-teleprompter.html')
await writeFile(target, page)

const megabytes = (Buffer.byteLength(page) / 1024 / 1024).toFixed(2)
console.log(`[build-single] wrote dist-single/pdf-teleprompter.html (${megabytes} MB)`)
