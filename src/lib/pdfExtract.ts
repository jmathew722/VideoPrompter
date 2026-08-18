import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
// `?url` lets Vite emit the worker as a real asset and hand us its served URL.
// The worker and the main thread therefore always come from the same pinned
// pdfjs-dist version, which is the usual cause of runtime failures when mixed.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type ExtractErrorCode =
  | 'not-a-pdf'
  | 'password-protected'
  | 'no-text-layer'
  | 'empty-file'
  | 'unknown'

export class PdfExtractError extends Error {
  code: ExtractErrorCode

  constructor(code: ExtractErrorCode, message: string) {
    super(message)
    this.name = 'PdfExtractError'
    this.code = code
  }
}

export interface ExtractResult {
  /** Whole document as one string, paragraphs separated by blank lines. */
  text: string
  /** The same content split into reflowable paragraphs. */
  paragraphs: string[]
  wordCount: number
  pageCount: number
}

/**
 * A single text run as reported by PDF.js, projected into page coordinates.
 * PDF space has its origin at the bottom-left, so larger `y` means higher up.
 */
interface Run {
  str: string
  x: number
  y: number
  width: number
  fontSize: number
  /** PDF.js marks runs that the content stream ends a line on. */
  hasEOL: boolean
  /** Position in the original content stream, needed to interpret `hasEOL`. */
  index: number
}

/** A cluster of runs sharing a baseline, already ordered left-to-right. */
interface Line {
  text: string
  y: number
  x0: number
  x1: number
  fontSize: number
}

const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
}

/** Undo the encoding artefacts that make extracted PDF text awkward to read aloud. */
function normalize(input: string): string {
  return input
    .replace(/[\uFB00-\uFB06]/g, (ch) => LIGATURES[ch] ?? ch)
    .replace(/\u00AD/g, '') // soft hyphen
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '') // zero-width and bidi marks
    .replace(/[\u00A0\u2007\u202F]/g, ' ') // non-breaking spaces
    .replace(/[\u2010\u2011]/g, '-') // hyphen variants
    .replace(/[ \t]+/g, ' ')
}

const SENTENCE_END = /[.!?:;"'”’»)\]]\s*$/
const BULLET_START =
  /^\s*(?:[•‣◦⁃∙*·–—-]\s+|\(?\d{1,3}[.)]\s+|[a-z][.)]\s+|[ivxlcdm]{1,5}[.)]\s+)/i
const PAGE_LABEL = /^(?:page\s+)?[\divxlcdm]{1,7}(?:\s*(?:of|\/)\s*\d{1,5})?$/i

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Finds a vertical gutter that splits `runs` into two columns.
 *
 * Works by painting every run's horizontal extent into an occupancy histogram
 * and looking for the widest interior band that no run touches. A band only
 * counts as a gutter if it is wide relative to the text block and if both sides
 * carry a meaningful share of the content across several distinct baselines —
 * otherwise ragged single-column prose would split on incidental whitespace.
 */
function findColumnSplit(runs: Run[]): number | null {
  // Simple PDFs emit one run per line, so the meaningful floor is how many
  // baselines the page has, not how many runs.
  if (runs.length < 8) return null

  const typicalFontSize = median(runs.map((r) => r.fontSize)) || 10
  const rowBand = Math.max(typicalFontSize, 1)
  const rowOf = (run: Run) => Math.round(run.y / rowBand)
  const distinctRows = (subset: Run[]) => new Set(subset.map(rowOf)).size
  if (distinctRows(runs) < 5) return null

  let minX = Infinity
  let maxX = -Infinity
  for (const run of runs) {
    if (run.x < minX) minX = run.x
    if (run.x + run.width > maxX) maxX = run.x + run.width
  }
  const span = maxX - minX
  if (!Number.isFinite(span) || span <= 0) return null

  const BINS = 240
  const binWidth = span / BINS
  const occupied = new Uint8Array(BINS)

  for (const run of runs) {
    const from = Math.max(0, Math.floor((run.x - minX) / binWidth))
    const to = Math.min(BINS - 1, Math.ceil((run.x + run.width - minX) / binWidth))
    for (let i = from; i <= to; i++) occupied[i] = 1
  }

  // Only interior gaps matter; page margins are not gutters.
  let first = 0
  while (first < BINS && !occupied[first]) first++
  let last = BINS - 1
  while (last >= 0 && !occupied[last]) last--
  if (last - first < 8) return null

  let best: { start: number; end: number } | null = null
  let gapStart = -1
  for (let i = first; i <= last; i++) {
    if (!occupied[i]) {
      if (gapStart === -1) gapStart = i
    } else if (gapStart !== -1) {
      if (!best || i - gapStart > best.end - best.start) best = { start: gapStart, end: i }
      gapStart = -1
    }
  }
  if (!best) return null

  const gapWidth = (best.end - best.start) * binWidth
  if (gapWidth < Math.max(span * 0.035, typicalFontSize * 1.1)) return null

  const splitX = minX + ((best.start + best.end) / 2) * binWidth
  const left = runs.filter((r) => r.x + r.width / 2 < splitX)
  const right = runs.filter((r) => r.x + r.width / 2 >= splitX)
  const minShare = Math.max(3, runs.length * 0.15)
  if (left.length < minShare || right.length < minShare) return null

  // Both sides must span several baselines, or this is a heading beside a
  // figure rather than a genuine pair of columns.
  if (distinctRows(left) < 4 || distinctRows(right) < 4) return null

  return splitX
}

/**
 * Splits a baseline cluster using the content stream's own line breaks.
 *
 * Two visually distinct lines can land in the same y-cluster when leading is
 * tight. `hasEOL` marks where the stream broke the line, but it also fires
 * mid-line in some producers, so a split is only kept when the next segment
 * starts to the left of where the previous one ended — text that moved
 * backwards cannot be a continuation of the same visual line.
 */
function splitClusterByEol(cluster: Run[]): Run[][] {
  const byStream = [...cluster].sort((a, b) => a.index - b.index)
  const segments: Run[][] = []
  let current: Run[] = []

  for (const run of byStream) {
    current.push(run)
    if (run.hasEOL) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)
  if (segments.length < 2) return [cluster]

  const merged: Run[][] = []
  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (!previous) {
      merged.push(segment)
      continue
    }
    const previousEnd = Math.max(...previous.map((r) => r.x + r.width))
    const segmentStart = Math.min(...segment.map((r) => r.x))
    if (segmentStart >= previousEnd - 1) {
      merged[merged.length - 1] = [...previous, ...segment]
    } else {
      merged.push(segment)
    }
  }
  return merged
}

/** Joins one line's runs, inserting spaces only where a real gap exists. */
function toLine(runs: Run[], fallbackFontSize: number): Line {
  const ordered = [...runs].sort((a, b) => a.x - b.x)
  let text = ''

  for (let i = 0; i < ordered.length; i++) {
    const run = ordered[i]
    if (i > 0) {
      const previous = ordered[i - 1]
      const gap = run.x - (previous.x + previous.width)
      const threshold = Math.max(previous.fontSize, run.fontSize) * 0.18
      const alreadySpaced = /\s$/.test(text) || /^\s/.test(run.str)
      // PDF.js splits runs for kerning mid-word, so only a real gap is a space.
      if (!alreadySpaced && gap > threshold) text += ' '
    }
    text += run.str
  }

  return {
    text: normalize(text).trim(),
    y: median(ordered.map((r) => r.y)),
    x0: Math.min(...ordered.map((r) => r.x)),
    x1: Math.max(...ordered.map((r) => r.x + r.width)),
    fontSize: median(ordered.map((r) => r.fontSize)) || fallbackFontSize,
  }
}

/** Groups runs sharing a baseline into lines, ordered top-to-bottom. */
function buildLines(runs: Run[]): Line[] {
  if (runs.length === 0) return []

  const typicalFontSize = median(runs.map((r) => r.fontSize)) || 10
  const tolerance = Math.max(1.5, typicalFontSize * 0.4)

  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)
  const clusters: Run[][] = []
  let current: Run[] = [sorted[0]]
  let baseline = sorted[0].y

  for (let i = 1; i < sorted.length; i++) {
    const run = sorted[i]
    if (Math.abs(run.y - baseline) <= tolerance) {
      current.push(run)
    } else {
      clusters.push(current)
      current = [run]
      baseline = run.y
    }
  }
  clusters.push(current)

  return clusters.flatMap((cluster) =>
    splitClusterByEol(cluster).map((segment) => toLine(segment, typicalFontSize)),
  )
}

/** Orders a page's runs into lines, recursing into columns where they exist. */
function orderRuns(runs: Run[], depth = 0): Line[] {
  const splitX = depth < 2 ? findColumnSplit(runs) : null
  if (splitX === null) return buildLines(runs)

  const left: Run[] = []
  const right: Run[] = []
  for (const run of runs) {
    if (run.x + run.width / 2 < splitX) left.push(run)
    else right.push(run)
  }
  // A whole column is read before the next one begins.
  return [...orderRuns(left, depth + 1), ...orderRuns(right, depth + 1)]
}

/**
 * Drops running headers and footers: bare page numbers in the margins, plus any
 * line that repeats in the same margin position across most pages.
 */
function stripRunningHeadFoot(pages: Line[][]): Line[][] {
  if (pages.length < 4) {
    return pages.map((lines) => lines.filter((line) => !PAGE_LABEL.test(line.text)))
  }

  const tally = (pick: (lines: Line[]) => Line | undefined) => {
    const counts = new Map<string, number>()
    for (const lines of pages) {
      const line = pick(lines)
      if (!line || line.text.length === 0 || line.text.length > 120) continue
      // Page numbers vary per page, so compare on a digit-blind key.
      const key = line.text.replace(/\d+/g, '#')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const threshold = pages.length * 0.6
    return new Set([...counts].filter(([, n]) => n >= threshold).map(([key]) => key))
  }

  const headers = tally((lines) => lines[0])
  const footers = tally((lines) => lines[lines.length - 1])

  return pages.map((lines) =>
    lines.filter((line, index) => {
      if (PAGE_LABEL.test(line.text)) return false
      const key = line.text.replace(/\d+/g, '#')
      if (index === 0 && headers.has(key)) return false
      if (index === lines.length - 1 && footers.has(key)) return false
      return true
    }),
  )
}

/**
 * Reflows ordered lines into paragraphs. The prompter re-wraps text at the
 * user's chosen column width, so source line breaks are deliberately discarded
 * and only real paragraph boundaries are preserved.
 */
function linesToParagraphs(pages: Line[][]): string[] {
  const paragraphs: string[] = []
  let buffer = ''
  let previous: Line | null = null
  let previousWasPageEnd = false

  const flush = () => {
    const trimmed = buffer.replace(/\s+/g, ' ').trim()
    if (trimmed) paragraphs.push(trimmed)
    buffer = ''
  }

  for (const lines of pages) {
    if (lines.length === 0) continue

    // Typical leading on this page, used to recognise paragraph spacing.
    const deltas: number[] = []
    for (let i = 1; i < lines.length; i++) {
      const delta = lines[i - 1].y - lines[i].y
      if (delta > 0) deltas.push(delta)
    }
    const leading =
      median(deltas) || median(lines.map((l) => l.fontSize)) * 1.2 || 12
    const leftEdge = Math.min(...lines.map((l) => l.x0))
    const rightEdge = Math.max(...lines.map((l) => l.x1))
    const columnWidth = Math.max(rightEdge - leftEdge, 1)

    for (const line of lines) {
      if (!line.text) continue

      let startsParagraph = previous === null

      if (previous !== null) {
        if (previousWasPageEnd) {
          // Across a page break, only continue when the sentence clearly runs on.
          startsParagraph = SENTENCE_END.test(previous.text) || !/^[a-z(]/.test(line.text)
        } else {
          const gap = previous.y - line.y
          const fontJump =
            Math.abs(line.fontSize - previous.fontSize) > previous.fontSize * 0.25
          const shortLastLine =
            SENTENCE_END.test(previous.text) && previous.x1 < leftEdge + columnWidth * 0.85
          const indented = line.x0 > previous.x0 + previous.fontSize * 0.8
          startsParagraph =
            gap > leading * 1.55 ||
            gap < 0 || // moved back up the page, so this is a new block
            fontJump ||
            shortLastLine ||
            indented ||
            BULLET_START.test(line.text)
        }
      }

      if (startsParagraph) {
        flush()
        buffer = line.text
      } else if (/[-\u2010]$/.test(buffer) && /^[a-z]/.test(line.text)) {
        // Word hyphenated across a line break - rejoin it.
        buffer = buffer.slice(0, -1) + line.text
      } else {
        buffer += ' ' + line.text
      }

      previous = line
      previousWasPageEnd = false
    }

    previousWasPageEnd = true
  }

  flush()
  return paragraphs
}

const countWords = (text: string): number => {
  const matches = text.trim().match(/\S+/g)
  return matches ? matches.length : 0
}

function toFriendlyError(error: unknown): PdfExtractError {
  if (error instanceof PdfExtractError) return error

  const name = (error as { name?: string })?.name ?? ''
  const message = (error as { message?: string })?.message ?? ''

  if (name === 'PasswordException') {
    return new PdfExtractError(
      'password-protected',
      'This PDF is password-protected. Remove the password and try again.',
    )
  }
  if (name === 'InvalidPDFException' || /invalid pdf|structure/i.test(message)) {
    return new PdfExtractError(
      'not-a-pdf',
      "This file isn't a readable PDF - it may be corrupted, or renamed from another format.",
    )
  }
  return new PdfExtractError(
    'unknown',
    message ? `Could not read this PDF: ${message}` : 'Could not read this PDF.',
  )
}

/**
 * Extracts every page of a PDF as reading-ordered text, entirely in the browser.
 * Nothing is uploaded anywhere.
 */
export async function extractPdfText(
  file: File | ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<ExtractResult> {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new PdfExtractError('empty-file', 'That file is empty - there is nothing to read.')
  }

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    // Served from this app, so documents using predefined Adobe CMaps (most
    // CJK PDFs) still extract without any network access.
    cMapUrl: new URL(`${import.meta.env.BASE_URL}cmaps/`, document.baseURI).href,
    cMapPacked: true,
  })

  try {
    const pdf = await loadingTask.promise
    const pageLines: Line[][] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const runs: Run[] = []

        for (const item of content.items) {
          if (!('str' in item)) continue // marked-content markers carry no text
          const { str, transform, width, height, hasEOL } = item
          if (str.length === 0) continue

          // transform is [a, b, c, d, e, f]: e/f are the translation (x/y) and
          // the scale factors give the rendered font size.
          const fontSize = Math.hypot(transform[2], transform[3]) || height || 10
          runs.push({
            str,
            x: transform[4],
            y: transform[5],
            width,
            fontSize,
            hasEOL,
            index: runs.length,
          })
        }

        pageLines.push(orderRuns(runs).filter((line) => line.text.length > 0))
      } finally {
        page.cleanup()
      }
      onProgress?.(pageNumber / pdf.numPages)
    }

    const paragraphs = linesToParagraphs(stripRunningHeadFoot(pageLines))
    const text = paragraphs.join('\n\n')
    const wordCount = countWords(text)

    if (wordCount === 0) {
      throw new PdfExtractError(
        'no-text-layer',
        'No selectable text found. This looks like a scanned or image-only PDF, which needs OCR before it can be read.',
      )
    }

    if (import.meta.env.DEV) {
      console.info(
        `[pdfExtract] ${pdf.numPages} page(s), ${paragraphs.length} paragraph(s), ${wordCount} words`,
      )
      console.info(
        `[pdfExtract] preview: ${text.slice(0, 400)}${text.length > 400 ? '...' : ''}`,
      )
    }

    return { text, paragraphs, wordCount, pageCount: pdf.numPages }
  } catch (error) {
    throw toFriendlyError(error)
  } finally {
    void loadingTask.destroy()
  }
}
