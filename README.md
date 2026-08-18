# PDF Teleprompter

Drop in a PDF, read it aloud on camera. The app extracts the document's text and
scrolls it past a fixed eye-line at a pace you set in words per minute, with a
floating always-on-top window for reading over a video call.

Everything runs in the browser. There is no backend, and the PDF is never
uploaded anywhere.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed URL and drop a PDF onto the page.

| Script              | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Dev server with hot reload                          |
| `npm run build`     | Typecheck and build to `dist/`                      |
| `npm run preview`   | Serve the production build locally                  |
| `npm run typecheck` | TypeScript only                                     |
| `npm run lint`      | oxlint                                              |
| `npm run test:e2e`  | Build, then run the browser suite                   |
| `npm run assets`    | Copy PDF.js CMaps into `public/` (runs on its own)  |

## Using it

Press play, wait out the countdown, and read at the eye-line marker. The
controls fade out a couple of seconds into the read so they stay out of shot,
and come back the moment you move the mouse.

| Key           | Action                  |
| ------------- | ----------------------- |
| `Space`       | Play / pause            |
| `↑` `↓`       | Speed up / slow down    |
| `←` `→`       | Smaller / larger text   |
| `R`           | Back to the top         |
| `M`           | Mirror the text         |
| `F`           | Fullscreen              |
| `PgUp` `PgDn` | Jump back / forward     |
| `Home` `End`  | Start / end of script   |

The scroll wheel scrubs through the script, and the progress bar at the top is
clickable. Settings persist in `localStorage`.

### Reading over a video call

On Chromium (Chrome or Edge 116+), **Pop out** opens a real always-on-top
window using the [Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture).
Drag it next to your webcam and read from there; the browser tab keeps the
controls in reach.

Safari and Firefox do not implement that API, so the button is hidden there.
Use fullscreen, or open a second browser window and position it manually.

## How it works

```
src/
  components/
    UploadScreen.tsx     drag-and-drop, extraction progress, error states
    PrompterView.tsx     stage composition, control auto-hide, PiP portal
    PrompterScreen.tsx   reading column, eye-line, mirror wrapper
    ControlBar.tsx       transport and quick settings
    SettingsPanel.tsx    pace, typography, display, shortcut reference
    Countdown.tsx        3-2-1 overlay
    ProgressBar.tsx      progress readout and scrub bar
  hooks/
    useAutoScroll.ts     requestAnimationFrame scroll engine
    useKeyboardShortcuts.ts
    useFullscreen.ts
    usePictureInPicture.ts
  lib/
    pdfExtract.ts        pdfjs-dist text extraction and reading-order logic
    format.ts
  store/
    prompterStore.ts     zustand state, settings persisted to localStorage
```

**Text extraction** (`lib/pdfExtract.ts`) walks every page with `pdfjs-dist`,
takes each text run's position from its transform matrix, and rebuilds reading
order: runs are clustered into lines by baseline, lines are split where the
content stream's `hasEOL` disagrees with the clustering, and pages are checked
for a vertical gutter so a two- or three-column layout is read one full column
at a time. Paragraphs are then reflowed — source line breaks are deliberately
discarded so text can re-wrap at whatever column width you choose — with
hyphenated words rejoined, running headers and page numbers dropped, and
sentences that run across a page break stitched back together.

**Scrolling** (`hooks/useAutoScroll.ts`) runs a `requestAnimationFrame` loop
that advances an offset by `pixelsPerSecond × deltaTime` and writes it to the
DOM as a `translate3d`, so it is frame-rate independent and compositor-driven.
Speed comes from the measured pixel height of the script divided by its word
count, scaled by WPM — every word gets the same screen time regardless of
window size, and changing speed mid-read takes effect on the next frame. When
the layout reflows, the reader's place is preserved proportionally.

## Tests

`npm run test:e2e` builds the app, serves `dist/`, and drives it in Chromium
with Playwright. It generates its own PDFs first (`tests/fixtures.mjs`) — a
five-page script with a two-column spread, a running header, page-number
footers, words hyphenated across line breaks, and a sentence spanning a page
boundary — then asserts on extraction, scrolling, shortcuts, settings,
persistence, the floating window, rejected files, and layout at phone, tablet
and desktop widths.

```bash
npm run test:e2e

# against an already-running server, e.g. the dev server
BASE=http://localhost:5173/ node tests/e2e.mjs

# when Chromium is not where Playwright expects it
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

Playwright needs a browser once: `npx playwright install chromium`.

## Known limits

- **Scanned or image-only PDFs have no text layer** and cannot be read without
  OCR. The app detects this and says so rather than opening an empty prompter.
- **Document Picture-in-Picture is Chromium-only.** Everywhere else, fullscreen
  or a manually placed second window is the fallback.
- **Unusual layouts may need tuning.** Tables, sidebars and pull quotes can
  confuse any reading-order heuristic; the thresholds live at the top of
  `findColumnSplit` and `linesToParagraphs`.
- The CMap files copied into `public/cmaps` are generated output and are not
  checked in — `npm run dev` and `npm run build` copy them automatically.

## Built with

Vite, React, TypeScript, Tailwind CSS v4, `pdfjs-dist` (pinned), `react-dropzone`,
`lucide-react` and `zustand`.
