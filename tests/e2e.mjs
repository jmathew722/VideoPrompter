/**
 * End-to-end checks against a real browser and a real PDF.
 *
 * Run with `npm run test:e2e`, which builds first and serves `dist/` here. Set
 * `BASE` to point at an already-running server instead (the dev server, for
 * example), and `PLAYWRIGHT_CHROMIUM_PATH` when Chromium lives somewhere
 * Playwright would not find on its own.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { EXPECTED, buildFixtures } from './fixtures.mjs'

const FIXTURES = fileURLToPath(new URL('./.fixtures/', import.meta.url))
const PORT = Number(process.env.PORT ?? 4173)
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const results = []
let group = ''

const section = (name) => {
  group = name
  console.log(`\n${name}`)
}

const check = (name, pass, detail = '') => {
  results.push({ group, name, pass })
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server at ${url} did not come up within ${timeoutMs}ms`)
}

async function startPreviewServer() {
  const child = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore' },
  )
  await waitForServer(`http://localhost:${PORT}/`)
  return () => child.kill('SIGTERM')
}

// --- helpers bound to a page -------------------------------------------------

const offsetOf = (page) =>
  page.$eval('.prompter-stage .will-change-transform', (el) => {
    const match = /translate3d\(0px,\s*(-?[\d.]+)px/.exec(el.style.transform)
    return match ? Number(match[1]) : NaN
  })

const barText = (page) => page.textContent('.prompter-stage')
const wpmOf = async (page) => Number((/(\d+) wpm/.exec((await barText(page)) ?? '') ?? [])[1])

const loadScript = async (page, base, file = 'script.pdf') => {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.setInputFiles('input[type="file"]', `${FIXTURES}${file}`)
  await page.waitForSelector('.prompter-stage', { timeout: 30_000 })
}

// --- the suite ---------------------------------------------------------------

async function run() {
  await buildFixtures(FIXTURES)

  const base = process.env.BASE ?? `http://localhost:${PORT}/`
  const stopServer = process.env.BASE ? null : await startPreviewServer()
  const browser = await chromium.launch({ executablePath: CHROMIUM })

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    // ---- extraction ----
    section('Extraction')
    await page.goto(base, { waitUntil: 'networkidle' })
    check('upload screen renders', await page.getByText('Drag a PDF here').isVisible())

    await loadScript(page, base)
    const paragraphs = await page.$$eval('.prompter-stage p', (nodes) =>
      nodes.map((node) => node.textContent ?? ''),
    )
    const text = paragraphs.join('\n')

    check('title captured', text.includes(EXPECTED.title))
    check('prose captured', text.includes(EXPECTED.prose))
    check('paragraphs kept separate', paragraphs.length >= 5, `${paragraphs.length}`)

    const firstColumn = text.indexOf(EXPECTED.columnFirst)
    const secondColumn = text.indexOf(EXPECTED.columnSecond)
    check(
      'columns read one at a time',
      firstColumn !== -1 && secondColumn !== -1 && firstColumn < secondColumn,
      `left@${firstColumn} right@${secondColumn}`,
    )
    for (const word of EXPECTED.rejoined) {
      check(`hyphenated word rejoined (${word.split(' ')[0]})`, text.includes(word))
    }
    check(
      'sentence continues across a page break',
      text.replace(/\s+/g, ' ').includes(EXPECTED.acrossPages),
    )
    for (const noise of EXPECTED.removed) {
      check(`running head/foot removed (${noise})`, !text.includes(noise))
    }
    check('word count shown', /\d+ words/.test((await barText(page)) ?? ''))

    // ---- scrolling ----
    section('Scrolling')
    check('starts at the top', (await offsetOf(page)) === 0)

    await page.keyboard.press('Space')
    await page.waitForTimeout(600)
    check('countdown appears', await page.locator('[role="status"]').isVisible())

    await page.waitForTimeout(4200)
    const before = await offsetOf(page)
    await page.waitForTimeout(1500)
    const after = await offsetOf(page)
    check('scrolls while playing', after < before, `${before} -> ${after}`)

    await page.keyboard.press('Space')
    await page.waitForTimeout(200)
    const paused = await offsetOf(page)
    await page.waitForTimeout(900)
    check('pause holds position', (await offsetOf(page)) === paused)

    const slow = (before - after) / 1.5
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Space')
    await page.waitForTimeout(4200)
    const fastFrom = await offsetOf(page)
    await page.waitForTimeout(1500)
    const fastTo = await offsetOf(page)
    await page.keyboard.press('Space')
    const fast = (fastFrom - fastTo) / 1.5
    check('raising wpm speeds up scrolling', fast > slow, `${slow.toFixed(1)} -> ${fast.toFixed(1)} px/s`)

    await page.mouse.move(640, 400)
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(120)
    check('wheel scrubs the script', Number.isFinite(await offsetOf(page)))

    await page.keyboard.press('End')
    await page.waitForTimeout(200)
    const atEnd = await page.$eval('[role="slider"]', (el) =>
      Number(el.getAttribute('aria-valuenow')),
    )
    check('End reaches the end', atEnd === 100, `${atEnd}%`)

    await page.keyboard.press('Space')
    await page.waitForTimeout(200)
    check('play at the end restarts from the top', (await offsetOf(page)) === 0)
    await page.keyboard.press('Space')

    // ---- shortcuts ----
    section('Keyboard')
    await page.keyboard.press('KeyR')
    await page.waitForTimeout(150)
    check('R returns to the top', (await offsetOf(page)) === 0)

    const baseWpm = await wpmOf(page)
    await page.keyboard.press('ArrowUp')
    check('ArrowUp raises wpm', (await wpmOf(page)) === baseWpm + 5)
    await page.keyboard.press('ArrowDown')
    check('ArrowDown lowers wpm', (await wpmOf(page)) === baseWpm)

    const fontOf = () =>
      page.$eval('.prompter-stage p', (el) => getComputedStyle(el.parentElement).fontSize)
    const fontBefore = await fontOf()
    await page.keyboard.press('ArrowRight')
    check('ArrowRight enlarges text', parseFloat(await fontOf()) > parseFloat(fontBefore))
    await page.keyboard.press('ArrowLeft')
    check('ArrowLeft shrinks text', (await fontOf()) === fontBefore)

    await page.keyboard.press('KeyM')
    const mirrored = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('.prompter-stage div'))
          .map((el) => el.style.transform)
          .find((value) => value.includes('scale')) ?? '',
    )
    check('M mirrors the text', mirrored.includes('scaleX(-1)'), mirrored)
    await page.keyboard.press('KeyM')

    // ---- settings ----
    section('Settings')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForTimeout(300)
    check('panel opens', await page.getByLabel('Prompter settings').isVisible())

    await page.getByRole('slider', { name: 'Reading width' }).fill('600')
    await page.waitForTimeout(200)
    const columnWidth = await page.$eval('.prompter-stage p', (el) =>
      el.parentElement.getBoundingClientRect().width,
    )
    check('reading width applies', columnWidth <= 600, `${Math.round(columnWidth)}px`)

    await page.getByRole('slider', { name: 'Line spacing' }).fill('2')
    await page.waitForTimeout(150)
    const lineHeight = await page.$eval('.prompter-stage p', (el) =>
      getComputedStyle(el.parentElement).lineHeight,
    )
    check('line spacing applies', parseFloat(lineHeight) > 90, lineHeight)

    await page.getByRole('button', { name: 'serif', exact: true }).click()
    await page.waitForTimeout(150)
    const family = await page.$eval('.prompter-stage p', (el) =>
      getComputedStyle(el.parentElement).fontFamily,
    )
    check('serif typeface applies', /serif/i.test(family))

    await page.getByRole('switch', { name: 'Dark theme' }).click()
    await page.waitForTimeout(250)
    const stageBackground = await page.$eval(
      '.prompter-stage',
      (el) => getComputedStyle(el).backgroundColor,
    )
    check('light theme repaints the stage', stageBackground === 'rgb(255, 255, 255)', stageBackground)

    const knobs = await page.$$eval('[role="switch"]', (buttons) =>
      buttons.map((button) => {
        const knob = button.querySelector('span')
        const track = button.getBoundingClientRect()
        const dot = knob.getBoundingClientRect()
        return {
          checked: button.getAttribute('aria-checked') === 'true',
          insideTrack: dot.left >= track.left - 1 && dot.right <= track.right + 1,
        }
      }),
    )
    check(
      'switch knobs sit inside their track',
      knobs.length > 0 && knobs.every((knob) => knob.insideTrack),
      `${knobs.length} switches`,
    )

    await page.getByRole('switch', { name: 'Dark theme' }).click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const hidden = await page.$eval('[aria-label="Prompter settings"]', (el) =>
      el.getAttribute('aria-hidden'),
    )
    check('Escape closes the panel', hidden === 'true')

    // ---- persistence ----
    section('Persistence')
    await page.keyboard.press('ArrowUp')
    const wpmBeforeReload = await wpmOf(page)
    await page.reload({ waitUntil: 'networkidle' })
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('pdf-teleprompter-settings') ?? '{}'),
    )
    check(
      'settings survive a reload',
      stored?.state?.wpm === wpmBeforeReload,
      `stored ${stored?.state?.wpm}`,
    )

    // ---- floating window ----
    section('Floating window')
    await loadScript(page, base)
    const pipSupported = await page.evaluate(() => 'documentPictureInPicture' in window)
    const popOut = page.getByRole('button', { name: 'Pop out (floating window)' })
    check(
      'pop-out button matches feature detection',
      (await popOut.count()) === (pipSupported ? 1 : 0),
      `supported: ${pipSupported}`,
    )

    if (pipSupported) {
      await popOut.click()
      await page.waitForTimeout(1200)
      const inside = await page.evaluate(() => {
        const floating = window.documentPictureInPicture.window
        if (!floating) return null
        return {
          paragraphs: floating.document.querySelectorAll('.prompter-stage p').length,
          styles: floating.document.head.querySelectorAll('style,link').length,
          theme: floating.document.documentElement.className,
        }
      })
      check('floating window opens with the script', (inside?.paragraphs ?? 0) > 0, JSON.stringify(inside))
      check('styles copied across', (inside?.styles ?? 0) > 0)
      check('theme copied across', Boolean(inside?.theme))
      check(
        'tab shows the pop-out placeholder',
        await page.getByText('Playing in the floating window').isVisible(),
      )
      await page.getByRole('button', { name: 'Bring it back here' }).click()
      await page.waitForTimeout(800)
      check('closing it restores the tab', await page.locator('.prompter-stage').isVisible())
    }

    section('Fullscreen')
    await page.keyboard.press('KeyF')
    await page.waitForTimeout(400)
    const fullscreen = await page.evaluate(() => document.fullscreenElement !== null)
    check('F enters fullscreen', fullscreen)
    if (fullscreen) {
      await page.keyboard.press('KeyF')
      await page.waitForTimeout(300)
    }

    // ---- bad input ----
    section('Rejected files')
    await page.getByRole('button', { name: 'Open a different PDF' }).click()
    await page.waitForTimeout(300)
    check('returns to the upload screen', await page.getByText('Drag a PDF here').isVisible())

    const cases = [
      ['scanned.pdf', /scanned or image-only/i],
      ['broken.pdf', /readable PDF/i],
      ['empty.pdf', /empty/i],
    ]
    for (const [file, expected] of cases) {
      await page.setInputFiles('input[type="file"]', `${FIXTURES}${file}`)
      await page.waitForSelector('[role="alert"]', { timeout: 20_000 })
      const message = (await page.getByRole('alert').textContent()) ?? ''
      check(`${file} explains itself`, expected.test(message), message.slice(0, 70))
      await page.setInputFiles('input[type="file"]', [])
    }

    await page.setInputFiles('input[type="file"]', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a pdf'),
    })
    await page.waitForTimeout(400)
    check('non-PDF is rejected', await page.getByRole('alert').isVisible())

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
    await page.close()

    // ---- responsive ----
    section('Responsive')
    for (const [label, width, height, expectedFont] of [
      ['phone', 390, 844, 30],
      ['tablet', 768, 1024, 40],
      ['desktop', 1440, 900, 48],
    ]) {
      const view = await browser.newPage({ viewport: { width, height } })
      // No mobile browser ships Document Picture-in-Picture, so drop it to
      // measure the control bar the way a phone would really render it.
      if (width < 640) {
        await view.addInitScript(() => {
          delete window.documentPictureInPicture
        })
      }
      await loadScript(view, base)
      await view.waitForTimeout(300)

      const layout = await view.evaluate(() => {
        const root = document.documentElement
        const bar = document.querySelector('.prompter-stage .absolute.inset-x-0.bottom-0 > div')
        const column = document.querySelector('.prompter-stage p')?.parentElement
        return {
          overflowX: root.scrollWidth - root.clientWidth,
          barHeight: Math.round(bar.getBoundingClientRect().height),
          barFitsViewport:
            bar.getBoundingClientRect().left >= 0 &&
            bar.getBoundingClientRect().right <= window.innerWidth,
          fontSize: parseFloat(getComputedStyle(column).fontSize),
        }
      })

      check(`${label}: no horizontal overflow`, layout.overflowX === 0, `${layout.overflowX}px`)
      check(`${label}: control bar fits`, layout.barFitsViewport && layout.barHeight <= 110, `${layout.barHeight}px tall`)
      check(`${label}: default text size suits the screen`, layout.fontSize === expectedFont, `${layout.fontSize}px`)
      await view.close()
    }
  } finally {
    await browser.close()
    stopServer?.()
  }

  const failed = results.filter((result) => !result.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) {
    for (const failure of failed) console.log(`  FAILED  ${failure.group}: ${failure.name}`)
    process.exitCode = 1
  }
}

await run()
