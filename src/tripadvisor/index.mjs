// Library entry for downloading the photos of a restaurant's TripAdvisor page, in the user's own Edge window.
// Silent unless a `log` function is given; importing this file loads nothing heavy (playwright is loaded on use).
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_CDP, ensureEdge } from '../lib/edge.mjs'
import { TablefactsError, optionError } from '../lib/errors.mjs'
import { assertImageResponse, writeImage } from '../lib/images.mjs'
import { normalizeLog } from '../lib/log.mjs'
import { DELAY_MS, newSummary, prepareOut, storeFile } from '../lib/photos.mjs'
import { loadPlaywright } from '../lib/playwright.mjs'
import { fileName, findPhotos, normalizeRestaurant, sizeCandidates } from './links.mjs'

const MIN_BYTES = 5000

// TripAdvisor's bot protection (DataDome) puts a challenge page, often in an iframe from
// captcha-delivery.com, in front of the restaurant. In a real window it passes alone or after a
// tick by the user. We only wait for the real page (it has an h1) to appear, never try to solve it.
const CHALLENGE = 'iframe[src*="captcha-delivery.com"], iframe[src*="datadome"]'

async function waitForCheck(page, log) {
  const passed = () => page.evaluate((sel) => !document.querySelector(sel) && !!document.querySelector('h1'), CHALLENGE)
  if (await passed()) return
  log('  waiting for the TripAdvisor check: tick it in the browser window if it asks (2 min)')
  await page
    .waitForFunction((sel) => !document.querySelector(sel) && !!document.querySelector('h1'), CHALLENGE, { timeout: 120000 })
    .catch(() => {
      throw new TablefactsError('the TripAdvisor check was not passed: tick it in the window, or use a normal Edge window', 'EFAILED')
    })
}

// The restaurant's own photos are in the carousel under data-section-signature="photo_viewer";
// clicking a photo opens a slideshow ("1 de 16 en Todas las fotos"). The rest of the page (nearby
// places, "keep planning", reviews of other places) also carries TripAdvisor photos that are NOT
// this restaurant's, so nothing outside the carousel and the slideshow is ever read.
const VIEWER = '[data-section-signature="photo_viewer"]'

async function openGallery(page) {
  const first = page.locator(`${VIEWER} button`).first()
  if (!(await first.count())) return false
  await first.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(2000)
  return true
}

// The big photos on screen now: the slideshow's current slide (and the carousel behind it).
const visibleSlides = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((img) => {
        const r = img.getBoundingClientRect()
        return r.width > 400 && r.height > 300 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
      })
      .map((img) => img.src)
      .join('\n'),
  )

// Steps through the slideshow with the arrow key, reading each slide, until two steps in a row show
// nothing new (the end or a wrap-around) or `max` photos are known. Without a slideshow, reads only
// the carousel on the page.
async function collect(page, max, opened) {
  const found = new Map()
  const add = (text) => {
    for (const photo of findPhotos(text)) if (!found.has(photo.key)) found.set(photo.key, photo)
  }
  if (!opened) {
    add(await page.locator(VIEWER).first().evaluate((el) => el.outerHTML).catch(() => ''))
    return [...found.values()].slice(0, max)
  }
  let idle = 0
  for (let step = 0; step < 300 && idle < 2 && found.size < max; step++) {
    const before = found.size
    add(await visibleSlides(page))
    idle = found.size === before ? idle + 1 : 0
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1000)
  }
  return [...found.values()].slice(0, max)
}

// Tries the biggest size first; not every photo exists in every size.
async function save(context, photo, file) {
  let last = 'no size worked'
  for (const url of sizeCandidates(photo)) {
    try {
      const res = await context.request.get(url)
      const bytes = await res.body()
      assertImageResponse({ ok: res.ok(), status: res.status(), contentType: res.headers()['content-type'], bytes, minBytes: MIN_BYTES })
      await writeImage(file, bytes)
      return
    } catch (err) {
      last = err.message
    }
  }
  throw new TablefactsError(last, 'EFAILED')
}

/**
 * Downloads the photos of TripAdvisor restaurant pages through the user's own Edge.
 * Resolves to a summary whose `failed` lists `{ item, reason }` and whose `found` is present only
 * in a dry run. Throws a TablefactsError on invalid arguments (code 'EUSAGE', with `option`), a
 * missing playwright ('EDEPENDENCY') or a browser that cannot be reached.
 * `out` resolves against `projectDir` (default: TABLEFACTS_PROJECT or the current folder).
 * `log(message, level)` gets level 'info', 'warn' or 'error'.
 * @param {import('../lib/types.mjs').TripadvisorOptions} options
 * @returns {Promise<import('../lib/types.mjs').PhotoSummary>}
 */
export async function downloadTripadvisor({
  links = [],
  out,
  cdp = DEFAULT_CDP,
  edgeDir,
  max = Infinity,
  projectDir,
  dryRun = false,
  debug = false,
  log: logOption,
} = {}) {
  const log = normalizeLog(logOption)
  if (!out) throw optionError('out', '`out` is required')
  const restaurants = []
  for (const raw of links) {
    const r = normalizeRestaurant(raw)
    if (r) restaurants.push(r)
    else log(`Skipping, not a TripAdvisor restaurant link: ${raw}`, 'warn')
  }
  if (!restaurants.length) throw optionError('links', 'no valid TripAdvisor restaurant links in `links`')

  const { outDir, debugDir } = await prepareOut({ out, dryRun, debug, projectDir })
  const summary = newSummary({ dryRun })

  const { chromium } = await loadPlaywright()
  let close
  try {
    await ensureEdge(cdp, edgeDir)
    const browser = await chromium.connectOverCDP(cdp)
    const context = browser.contexts()[0]
    let page
    close = async () => {
      try {
        await page?.close()
      } finally {
        await browser.close()
      }
    }
    page = await context.newPage()

    for (const [i, restaurant] of restaurants.entries()) {
      log(`[${i + 1}/${restaurants.length}] ${restaurant.url}`)
      try {
        await page.goto(restaurant.url, { waitUntil: 'domcontentloaded' })
        await waitForCheck(page, log)
        await page.getByRole('button', { name: /accept|aceptar|i agree/i }).first().click({ timeout: 2000 }).catch(() => {})
        const opened = await openGallery(page)
        log(opened ? '  photo slideshow opened' : '  no photo carousel found; reading nothing else on the page', opened ? 'info' : 'warn')
        const photos = await collect(page, max, opened)
        if (debugDir) await writeFile(join(debugDir, `${restaurant.id}.html`), await page.content())
        if (!photos.length) throw new TablefactsError('no photos found (markup changed, or the check page is still showing); run with `debug`', 'EFAILED')
        log(`  ${photos.length} photos`)
        for (const photo of photos) {
          const name = `${restaurant.id}-${fileName(photo)}`
          try {
            await storeFile({ outDir, name, url: photo.url, dryRun, summary, log, save: ({ file }) => save(context, photo, file) })
          } catch (err) {
            summary.failed.push({ item: name, reason: err.message })
            log(`  ${name} failed: ${err.message}`, 'error')
          }
        }
      } catch (err) {
        summary.failed.push({ item: restaurant.url, reason: err.message })
        log(`  failed: ${err.message}`, 'error')
      }
      if (i < restaurants.length - 1) await page.waitForTimeout(DELAY_MS)
    }
  } finally {
    await close?.().catch(() => {})
  }
  return summary
}
