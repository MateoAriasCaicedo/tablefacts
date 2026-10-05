// Downloads the photos of a restaurant's TripAdvisor page, in the user's own Edge window.
// Usage: extract photos tripadvisor --out <folder> [--cdp <url>] <restaurant link>...
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DEFAULT_CDP, ensureEdge } from '../lib/edge.mjs'
import { exists } from '../lib/files.mjs'
import { fileName, findPhotos, normalizeRestaurant, parseArgs, sizeCandidates } from './links.mjs'

const DELAY_MS = 2500
const MIN_BYTES = 5000

const HELP = `Download the photos of a restaurant's TripAdvisor page.

  extract photos tripadvisor --out <folder> [options] <restaurant link>...

  --out <folder>   where the images are saved (required, created if missing)
  --cdp <url>      attach to Edge on this debugging address (default http://localhost:9222). If nothing
                   is listening there the script starts Edge itself
  --edge-dir <dir> profile folder of that Edge (default C:\\ig-edge, shared with photos:instagram)
  --max <n>        stop after n photos per restaurant (default: all it can reach)
  --dry-run        print the photo URLs found, save nothing
  --debug          save the page HTML into <folder>/_debug, to fix the selectors
  --help           this text

The link is the restaurant's page, like https://www.tripadvisor.com/Restaurant_Review-g297478-d123-Reviews-Name.html
TripAdvisor shows a "verify you are human" check to automated browsers: if it appears in the window,
tick it yourself. This script waits for it and never tries to get around it.

Only download photos the restaurant owns or has allowed you to use. Most photos on TripAdvisor were
uploaded by guests, who keep the rights to them.`

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(HELP)
  process.exit(0)
}
if (!opts.out) {
  console.error('Missing --out <folder>.\n\n' + HELP)
  process.exit(2)
}
const restaurants = []
for (const raw of opts.links) {
  const r = normalizeRestaurant(raw)
  if (r) restaurants.push(r)
  else console.error(`Skipping, not a TripAdvisor restaurant link: ${raw}`)
}
if (!restaurants.length) {
  console.error('No restaurant links to download.')
  process.exit(2)
}

const cdp = opts.cdp ?? DEFAULT_CDP
const out = resolve(opts.out)
if (!opts.dryRun) await mkdir(out, { recursive: true })
const debugDir = opts.debug ? join(out, '_debug') : null
if (debugDir) await mkdir(debugDir, { recursive: true })

// TripAdvisor's bot protection (DataDome) puts a challenge page, often in an iframe from
// captcha-delivery.com, in front of the restaurant. In a real window it passes alone or after a
// tick by the user. We only wait for the real page (it has an h1) to appear, never try to solve it.
const CHALLENGE = 'iframe[src*="captcha-delivery.com"], iframe[src*="datadome"]'

async function waitForCheck(page) {
  const passed = () => page.evaluate((sel) => !document.querySelector(sel) && !!document.querySelector('h1'), CHALLENGE)
  if (await passed()) return
  console.log('  waiting for the TripAdvisor check: tick it in the browser window if it asks (2 min)')
  await page
    .waitForFunction((sel) => !document.querySelector(sel) && !!document.querySelector('h1'), CHALLENGE, { timeout: 120000 })
    .catch(() => {
      throw new Error('the TripAdvisor check was not passed: tick it in the window, or use a normal Edge window')
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
    let res
    try {
      res = await context.request.get(url)
    } catch (err) {
      last = err.message
      continue
    }
    if (!res.ok()) {
      last = `HTTP ${res.status()}`
      continue
    }
    if (!(res.headers()['content-type'] ?? '').startsWith('image/')) {
      last = 'not an image'
      continue
    }
    const body = await res.body()
    if (body.length < MIN_BYTES) {
      last = 'too small'
      continue
    }
    await writeFile(file, body)
    return
  }
  throw new Error(last)
}

const summary = { saved: 0, skipped: 0, failed: [] }
await ensureEdge(cdp, opts.edgeDir)
const browser = await chromium.connectOverCDP(cdp)
const context = browser.contexts()[0]
const page = await context.newPage()

for (const [i, restaurant] of restaurants.entries()) {
  console.log(`[${i + 1}/${restaurants.length}] ${restaurant.url}`)
  try {
    await page.goto(restaurant.url, { waitUntil: 'domcontentloaded' })
    await waitForCheck(page)
    await page.getByRole('button', { name: /accept|aceptar|i agree/i }).first().click({ timeout: 2000 }).catch(() => {})
    const opened = await openGallery(page)
    console.log(opened ? '  photo slideshow opened' : '  no photo carousel found; reading nothing else on the page')
    const photos = await collect(page, opts.max, opened)
    if (debugDir) await writeFile(join(debugDir, `${restaurant.id}.html`), await page.content())
    if (!photos.length) throw new Error('no photos found (markup changed, or the check page is still showing); run with --debug')
    console.log(`  ${photos.length} photos`)
    for (const photo of photos) {
      const name = `${restaurant.id}-${fileName(photo)}`
      if (opts.dryRun) {
        console.log(`  ${name} <- ${photo.url}`)
      } else if (await exists(join(out, name))) {
        summary.skipped++
        console.log(`  ${name} already there`)
      } else {
        try {
          await save(context, photo, join(out, name))
          summary.saved++
          console.log(`  ${name} saved`)
        } catch (err) {
          summary.failed.push({ post: name, reason: err.message })
          console.error(`  ${name} failed: ${err.message}`)
        }
      }
    }
  } catch (err) {
    summary.failed.push({ post: restaurant.url, reason: err.message })
    console.error(`  failed: ${err.message}`)
  }
  if (i < restaurants.length - 1) await page.waitForTimeout(DELAY_MS)
}

await page.close()
await browser.close()
console.log(`\nSaved ${summary.saved}, already there ${summary.skipped}, failed ${summary.failed.length}.`)
for (const f of summary.failed) console.log(`  ${f.post}: ${f.reason}`)
process.exit(summary.failed.length ? 1 : 0)
