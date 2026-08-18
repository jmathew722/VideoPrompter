// Generates the PDFs the end-to-end suite reads.
//
// The main fixture is deliberately awkward: a title page, a two-column spread,
// a running header, page-number footers, words hyphenated across line breaks,
// and a sentence that runs across a page boundary. Each of those is a case the
// extractor has to get right, and each is asserted on in `e2e.mjs`.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const WIDTH = 612
const HEIGHT = 792

/** Text that must survive extraction, in the order it must come out. */
export const EXPECTED = {
  title: 'The Quiet Machine',
  prose: 'counted the leaves that had fallen',
  columnFirst: 'LEFT eight ends the left column.',
  columnSecond: 'RIGHT one begins the right column',
  rejoined: ['townspeople', 'extraction quality'],
  acrossPages: 'here and now and so the sentence finally resolves',
  removed: ['Confidential Draft', 'Page 3'],
}

async function buildScript() {
  const doc = await PDFDocument.create()
  const body = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const draw = (page, text, { x, y, size = 11, font = body }) =>
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) })

  // Page 1 — a heading and two paragraphs, one with a hyphenated line break.
  const first = doc.addPage([WIDTH, HEIGHT])
  draw(first, EXPECTED.title, { x: 72, y: 700, size: 24, font: bold })
  ;[
    'Every morning the machine woke before the town did, and it counted the',
    'things that had changed overnight. It counted the leaves that had fallen,',
    'the windows that had opened, and the number of footsteps on the bridge.',
  ].forEach((line, i) => draw(first, line, { x: 72, y: 650 - i * 16 }))
  ;[
    'Nobody had asked it to do this. It simply began one winter and never',
    'stopped, which is the way most important habits are formed. The towns-',
    'people grew used to the sound and stopped hearing it altogether.',
  ].forEach((line, i) => draw(first, line, { x: 72, y: 580 - i * 16 }))

  // Page 2 — two columns that must be read one full column at a time.
  const second = doc.addPage([WIDTH, HEIGHT])
  draw(second, 'Two Column Section', { x: 72, y: 720, size: 16, font: bold })
  const left = [
    'LEFT one begins the left column here',
    'LEFT two continues the same thought',
    'LEFT three keeps the column running',
    'LEFT four is still on the left side',
    'LEFT five carries on regardless',
    'LEFT six approaches the bottom',
    'LEFT seven is nearly the last',
    EXPECTED.columnFirst,
  ]
  const right = [
    EXPECTED.columnSecond,
    'RIGHT two continues on the right',
    'RIGHT three stays on the right side',
    'RIGHT four is still over here',
    'RIGHT five carries on regardless',
    'RIGHT six approaches the bottom',
    'RIGHT seven is nearly the last',
    'RIGHT eight ends the right column.',
  ]
  left.forEach((line, i) => draw(second, line, { x: 60, y: 660 - i * 16, size: 9 }))
  right.forEach((line, i) => draw(second, line, { x: 330, y: 660 - i * 16, size: 9 }))

  // Pages 3-5 — running header, page-number footer, and a sentence that only
  // finishes on the following page.
  const rest = [
    [
      'The third page opens with a sentence that runs on past the edge of the',
      'page and continues onto the next one without any punctuation to stop',
      'it, because that is exactly the case worth testing here and now',
    ],
    [
      'and so the sentence finally resolves itself on the fourth page. A new',
      'paragraph starts here to prove that spacing is respected properly.',
    ],
    [
      'The fifth page closes the document with a short remark about extrac-',
      'tion quality and the importance of getting reading order right.',
    ],
  ]
  rest.forEach((lines, index) => {
    const page = doc.addPage([WIDTH, HEIGHT])
    draw(page, 'Confidential Draft', { x: 72, y: 740, size: 9 })
    lines.forEach((line, i) => draw(page, line, { x: 72, y: 660 - i * 16 }))
    draw(page, `Page ${index + 3}`, { x: 290, y: 60, size: 9 })
  })

  return doc.save()
}

/** A PDF with shapes but no text layer, standing in for a scan. */
async function buildScanned() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([WIDTH, HEIGHT])
  page.drawRectangle({ x: 72, y: 400, width: 400, height: 300, color: rgb(0.6, 0.6, 0.7) })
  page.drawCircle({ x: 300, y: 250, size: 80, color: rgb(0.3, 0.3, 0.4) })
  return doc.save()
}

export async function buildFixtures(dir) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'script.pdf'), await buildScript())
  await writeFile(join(dir, 'scanned.pdf'), await buildScanned())
  await writeFile(join(dir, 'broken.pdf'), Buffer.from('%PDF-1.4\nnot really a pdf\n'))
  await writeFile(join(dir, 'empty.pdf'), new Uint8Array(0))
  return dir
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = await buildFixtures(new URL('./.fixtures/', import.meta.url).pathname)
  console.log(`fixtures written to ${dir}`)
}
