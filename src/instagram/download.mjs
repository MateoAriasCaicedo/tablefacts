// Downloads the photos of Instagram posts through https://toolzu.com/downloader/instagram/photo/
// Usage: extract photos instagram --out <folder> [--cdp <url>] [--profile <link|@name>] [--file links.txt] [link...]
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ensureEdge } from '../lib/edge.mjs'
import { exists } from '../lib/files.mjs'
import { workDir } from '../lib/project.mjs'
import { normalize, parseArgs, parseProfile } from './links.mjs'

const TOOL = 'https://toolzu.com/downloader/instagram/photo/'
const PROFILE_TOOL = 'https://toolzu.com/downloader/instagram/profile/'
const IMAGE_HOSTS = /(cdninstagram\.com|fbcdn\.net)$/
const DELAY_MS = 2500
let googleDone = false

const HELP = `Download Instagram post photos through toolzu.com.

  extract photos instagram --out <folder> [options] [link...]

  --out <folder>   where the images are saved (required, created if missing)
  --file <path>    text file with one link per line (# comments and blank lines ignored)
  --cdp <url>      attach to Edge on this debugging address, e.g. http://localhost:9222. If nothing is
                   listening there the script starts Edge itself (the most reliable way past
                   toolzu's Cloudflare check)
  --edge-dir <dir> profile folder of that Edge, where the toolzu login is kept (default C:\ig-edge)
  --google         reach toolzu through a Google search, like a person would
  --browser <name> use an installed browser: msedge or chrome (default: bundled Chromium)
  --user-data-dir <dir>  browser profile kept between runs (default: .extract/instagram-profile)
  --profile <link|@name> download the photos of a whole Instagram profile (videos are skipped);
                   needs a toolzu account signed in to the browser
  --pages <n|all>  with --profile, how many batches of posts to load with NEXT (default 1)
  --headed         show the browser (to watch, or to pass a challenge by hand)
  --dry-run        print the image URLs found, save nothing
  --debug          save the page HTML after each submit into <folder>/_debug
  --help           this text

Every link saves all the images of its post; ?img_index=N in a link is ignored.

Only download photos the restaurant owns or has allowed you to use.`

async function readLinks(opts) {
  const raw = [...opts.links]
  if (opts.file) {
    const text = await readFile(opts.file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const t = line.replace(/#.*/, '').trim()
      if (t) raw.push(t)
    }
  }
  const seen = new Map()
  const bad = []
  for (const r of raw) {
    const n = normalize(r)
    if (!n) bad.push(r)
    else if (!seen.has(n.shortcode)) seen.set(n.shortcode, n)
  }
  return { posts: [...seen.values()], bad }
}

// Toolzu guards its forms with a Cloudflare Turnstile that fills a hidden field when passed.
// Headless fails it. In a real browser (--cdp) it passes alone, sometimes after 40 seconds;
// if it shows a box, tick it. We only wait for it, never try to solve it.
async function waitForCheck(page) {
  if (opts.headed || opts.cdp || opts.google) console.log('  waiting for the Cloudflare check: tick it in the browser window if it asks (2 min)')
  await page
    .waitForFunction(() => [...document.querySelectorAll('input[name*=turnstile]')].some((i) => i.value), null, { timeout: 120000 })
    .catch(() => {
      throw new Error('the Cloudflare check was not passed (use --cdp with your own browser, or solve it by hand)')
    })
}

// Clicks Download right after the link is pasted, as a person does. If toolzu answers that the
// check was not finished (it marks the box invalid), wait for the check and click again.
async function submitForm(page, path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = page
      .waitForResponse((r) => r.url().includes(path) && r.request().method() === 'POST', { timeout: attempt ? 60000 : 10000 })
      .catch(() => null)
    await page.click('#downloader-form button[type=submit]')
    const answered = await reply
    await page.waitForTimeout(500)
    if (answered && !(await page.locator('#instagramdownloaderform-search.is-invalid').count())) return
    await waitForCheck(page)
  }
  throw new Error('toolzu did not accept the link')
}

// Opens the tool from a Google search: type the query, click the toolzu result.
// Falls back to the direct address if Google asks for its own check or shows no result.
async function openFromGoogle(page, query, resultHref) {
  try {
    await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /accept all|aceptar todo/i }).click({ timeout: 3000 }).catch(() => {})
    const box = page.locator('textarea[name=q], input[name=q]').first()
    await box.click({ timeout: 10000 })
    await box.pressSequentially(query, { delay: 90 })
    await page.keyboard.press('Enter')
    await page.locator(`a[href*="${resultHref}"]`).first().click({ timeout: 20000 })
    await page.waitForSelector('#instagramdownloaderform-search', { timeout: 20000 })
    return true
  } catch {
    console.log('  Google did not lead to toolzu; opening it directly')
    return false
  }
}

// Submits one post link to the tool and returns the image URLs it offers.
async function findImages(page, post, debugDir) {
  // Through Google once, for the first link only; later links open the tool directly.
  const viaGoogle = opts.google && !googleDone && (googleDone = true) && (await openFromGoogle(page, 'toolzu instagram photo downloader', 'toolzu.com/downloader/instagram/photo'))
  if (!viaGoogle) await page.goto(TOOL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 2000 }).catch(() => {})
  await page.fill('#instagramdownloaderform-search', post.url)
  await submitForm(page, '/downloader/instagram/photo')
  // The results are injected after the response; the cards are what we wait for.
  await page.waitForSelector('#ajax-results .download-card', { timeout: 30000 }).catch(() => {})
  if (debugDir) await writeFile(join(debugDir, `${post.shortcode}.html`), await page.content())

  // Each result has a download button: <a download href="…cdninstagram.com/…">. Read those first
  // and only fall back to every link and image on the page if the markup changes.
  // `index` is the button's position among the page's Download buttons, so it can be clicked.
  const { urls, buttons } = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#ajax-results a[download]')].map((a) => a.href)
    if (buttons.length) return { urls: buttons, buttons: true }
    return { urls: [...document.querySelectorAll('#ajax-results a[href], #ajax-results img[src]')].map((el) => el.href ?? el.src), buttons: false }
  })
  const images = []
  for (const [index, url] of urls.entries()) {
    let host
    try {
      host = new URL(url).hostname
    } catch {
      continue
    }
    if (IMAGE_HOSTS.test(host) && !images.some((i) => i.url === url)) images.push({ url, index: buttons ? index : null })
  }
  return images
}

// The photo cards currently on the profile results page; videos (play icon) are left out.
function profileImages(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#ajax-results .download-card')]
      .filter((card) => card.querySelector('.fa-image'))
      .map((card) => card.querySelector('a[download]')?.href)
      .filter(Boolean),
  )
}

// Loads a profile through the profile tool and calls `handle` with the photo cards of each
// batch, following NEXT for `maxPages` batches. Returns how many photos it saw.
async function downloadProfile(page, profile, maxPages, handle) {
  const viaGoogle =
    opts.google && !googleDone && (googleDone = true) && (await openFromGoogle(page, 'toolzu instagram profile', 'toolzu.com/downloader/instagram/profile'))
  if (!viaGoogle) await page.goto(PROFILE_TOOL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 2000 }).catch(() => {})
  if (!(await page.getByText('Logout').count())) console.log('  not signed in to toolzu: the profile tool may ask you to sign up')
  await page.fill('#instagramdownloaderform-search', profile.url)
  await submitForm(page, '/downloader/instagram/profile')
  await page.waitForSelector('#ajax-results .download-card', { timeout: 60000 }).catch(() => {})

  const found = new Set()
  // Hands over the cards not seen yet, with their position among the photo cards on the page.
  const take = async () => {
    const fresh = (await profileImages(page)).map((url, index) => ({ url, index })).filter((c) => !found.has(c.url))
    for (const c of fresh) found.add(c.url)
    if (fresh.length) await handle(fresh)
    return fresh.length
  }
  await take()
  for (let n = 1; n < maxPages; n++) {
    const next = page.locator('#viewer-next')
    if (!(await next.count()) || !(await next.isVisible())) break
    console.log(`  loading batch ${n + 1} (${found.size} photos so far)`)
    const before = await page.locator('#ajax-results .download-card').count()
    const firstHref = await page.locator('#ajax-results a[download]').first().getAttribute('href')
    await next.click()
    // The next batch is in once there are more cards than before, or the first one is a different
    // photo (in case NEXT replaces the list instead of adding to it).
    await page
      .waitForFunction(
        ({ n, first }) =>
          document.querySelectorAll('#ajax-results .download-card').length > n ||
          document.querySelector('#ajax-results a[download]')?.getAttribute('href') !== first,
        { n: before, first: firstHref },
        { timeout: 90000 },
      )
      .catch(() => console.log('  NEXT brought no new photos'))
    const added = await take()
    if (!added && (await page.locator('#ajax-results .download-card').count()) <= before) break
    await page.waitForTimeout(DELAY_MS)
  }
  return found.size
}

// Clicks a card's Download button and saves what the browser receives. Depending on the link it
// arrives as a real download or opens the image in a new tab; both are handled.
async function saveByClick(page, link, file) {
  const context = page.context()
  const before = page.url()
  // First a click event sent straight to the button: nothing scrolls and nothing waits for the
  // layout to settle, which on a long list of lazy-loading cards is what makes a real click slow.
  // If that starts nothing, a real click (scroll, wait, click) is the fallback.
  let got = null
  for (const real of [false, true]) {
    const timeout = real ? 20000 : 8000
    const started = Promise.race([
      page.waitForEvent('download', { timeout }).then((download) => ({ download })),
      context.waitForEvent('page', { timeout }).then((tab) => ({ tab })),
    ])
    await (real ? link.click() : link.dispatchEvent('click'))
    got = await started.catch(() => null)
    if (got) break
  }
  if (!got) throw new Error('clicking Download started nothing')
  if (got.download) return got.download.saveAs(file)
  await got.tab.waitForURL((u) => u.toString() !== 'about:blank', { timeout: 15000 }).catch(() => {})
  const url = got.tab.url()
  await got.tab.close()
  if (page.url() !== before) throw new Error('the results page was left; Download navigated instead of saving')
  const res = await context.request.get(url)
  if (!res.ok()) throw new Error(`HTTP ${res.status()}`)
  if (!(res.headers()['content-type'] ?? '').startsWith('image/')) throw new Error('not an image')
  await writeFile(file, await res.body())
}

async function save(url, file) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`not an image (${type})`)
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
}

// Saves one image unless the file is already there (or only reports it in a dry run).
async function store(name, url, index = null) {
  if (opts.dryRun) {
    console.log(`  ${name} <- ${url}`)
  } else if (await exists(join(out, name))) {
    summary.skipped++
    console.log(`  ${name} already there`)
  } else {
    // The card's own Download button when we know which one it is, as a person clicks it.
    if (index === null) await save(url, join(out, name))
    else await saveByClick(page, page.locator('#ajax-results a[download]').nth(index), join(out, name))
    summary.saved++
    console.log(`  ${name} saved`)
  }
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  console.log(HELP)
  process.exit(0)
}
if (!opts.out) {
  console.error('Missing --out <folder>.\n\n' + HELP)
  process.exit(2)
}
const { posts, bad } = await readLinks(opts)
for (const b of bad) console.error(`Skipping, not an Instagram post link: ${b}`)
const profile = opts.profile ? parseProfile(opts.profile) : null
if (opts.profile && !profile) {
  console.error(`Not an Instagram profile: ${opts.profile}`)
  process.exit(2)
}
if (!posts.length && !profile) {
  console.error('No links to download.')
  process.exit(2)
}

const out = resolve(opts.out)
if (!opts.dryRun) await mkdir(out, { recursive: true })
const debugDir = opts.debug ? join(out, '_debug') : null
if (debugDir) await mkdir(debugDir, { recursive: true })

const summary = { saved: 0, skipped: 0, failed: [] }
let browser
let context
let page
if (opts.cdp) {
  // Your own browser: our tab is opened and closed here, the browser itself is left running.
  await ensureEdge(opts.cdp, opts.edgeDir)
  browser = await chromium.connectOverCDP(opts.cdp)
  context = browser.contexts()[0]
  page = await context.newPage()
} else {
  // A persistent profile keeps cookies between runs, which helps with the Cloudflare check.
  const profile = resolve(opts.userDataDir ?? workDir('instagram-profile'))
  context = await chromium.launchPersistentContext(profile, {
    channel: opts.browser,
    headless: !opts.headed,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  page = context.pages()[0] ?? (await context.newPage())
}

if (profile) {
  console.log(`Profile ${profile.url}`)
  try {
    const maxPages = opts.pages === 'all' ? Infinity : Math.max(1, Number(opts.pages) || 1)
    const handle = async (cards) => {
      console.log(`  ${cards.length} photos`)
      for (const { url, index } of cards) {
        // The file name from Instagram is unique per photo, so a re-run skips what is saved.
        const stem = new URL(url).pathname.split('/').pop().replace(/\.\w+$/, '').replace(/_n$/, '')
        const name = `${profile.user}-${stem}.jpg`
        if (opts.dryRun) {
          console.log(`  ${name} <- ${url}`)
        } else if (await exists(join(out, name))) {
          summary.skipped++
          console.log(`  ${name} already there`)
        } else {
          // The card's own Download button, as a person clicks it.
          await saveByClick(page, page.locator('#ajax-results .download-card:has(.fa-image) a[download]').nth(index), join(out, name))
          summary.saved++
          console.log(`  ${name} saved`)
          await page.waitForTimeout(150)
        }
      }
    }
    const seen = await downloadProfile(page, profile, maxPages, handle)
    if (!seen) throw new Error('the tool returned no photos')
  } catch (err) {
    summary.failed.push({ post: profile.url, reason: err.message })
    console.error(`  failed: ${err.message}`)
  }
}

for (const [i, post] of posts.entries()) {
  console.log(`[${i + 1}/${posts.length}] ${post.url}`)
  try {
    let images
    for (let attempt = 1; ; attempt++) {
      try {
        images = await findImages(page, post, debugDir)
        if (!images.length) throw new Error('the tool returned no images')
        break
      } catch (err) {
        if (attempt === 2) throw err
        console.log(`  retrying (${err.message})`)
      }
    }
    for (const [n, { url, index }] of images.entries()) await store(`${post.shortcode}-${n + 1}.jpg`, url, index)
  } catch (err) {
    summary.failed.push({ post: post.url, reason: err.message })
    console.error(`  failed: ${err.message}`)
  }
  if (i < posts.length - 1) await page.waitForTimeout(DELAY_MS)
}

if (opts.cdp) await page.close()
else await context.close()
await browser?.close()
console.log(`\nSaved ${summary.saved}, already there ${summary.skipped}, failed ${summary.failed.length}.`)
for (const f of summary.failed) console.log(`  ${f.post}: ${f.reason}`)
process.exit(summary.failed.length ? 1 : 0)
