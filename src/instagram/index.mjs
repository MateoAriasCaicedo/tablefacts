// Library entry for downloading Instagram post photos through https://toolzu.com/downloader/instagram/photo/
// Silent unless a `log` function is given; importing this file loads nothing heavy (playwright is loaded on use).
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureEdge } from '../lib/edge.mjs'
import { TablefactsError, optionError } from '../lib/errors.mjs'
import { assertImageResponse, writeImage } from '../lib/images.mjs'
import { normalizeLog } from '../lib/log.mjs'
import { DELAY_MS, newSummary, prepareOut, storeFile } from '../lib/photos.mjs'
import { loadPlaywright } from '../lib/playwright.mjs'
import { resolveIn, workDirIn } from '../lib/project.mjs'
import { normalize, parseProfile } from './links.mjs'

const TOOL = 'https://toolzu.com/downloader/instagram/photo/'
const PROFILE_TOOL = 'https://toolzu.com/downloader/instagram/profile/'
const IMAGE_HOSTS = /(cdninstagram\.com|fbcdn\.net)$/

async function readLinks(links, file) {
  const raw = [...links]
  if (file) {
    const text = await readFile(file, 'utf8')
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

// Runs `attempt` once more if it fails the first time, telling `onRetry` why.
async function retry(attempt, onRetry) {
  try {
    return await attempt()
  } catch (err) {
    onRetry(err)
    return attempt()
  }
}

// Toolzu guards its forms with a Cloudflare Turnstile that fills a hidden field when passed.
// Headless fails it. In a real browser (cdp) it passes alone, sometimes after 40 seconds;
// if it shows a box, tick it. We only wait for it, never try to solve it.
async function waitForCheck(page, log, visible) {
  if (visible) log('  waiting for the Cloudflare check: tick it in the browser window if it asks (2 min)')
  await page
    .waitForFunction(() => [...document.querySelectorAll('input[name*=turnstile]')].some((i) => i.value), null, { timeout: 120000 })
    .catch(() => {
      throw new TablefactsError('the Cloudflare check was not passed (use `cdp` with your own browser, or solve it by hand)', 'EFAILED')
    })
}

// Clicks Download right after the link is pasted, as a person does. If toolzu answers that the
// check was not finished (it marks the box invalid), wait for the check and click again.
async function submitForm(page, path, log, visible) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = page
      .waitForResponse((r) => r.url().includes(path) && r.request().method() === 'POST', { timeout: attempt ? 60000 : 10000 })
      .catch(() => null)
    await page.click('#downloader-form button[type=submit]')
    const answered = await reply
    await page.waitForTimeout(500)
    if (answered && !(await page.locator('#instagramdownloaderform-search.is-invalid').count())) return
    await waitForCheck(page, log, visible)
  }
  throw new TablefactsError('toolzu did not accept the link', 'EFAILED')
}

// Opens the tool from a Google search: type the query, click the toolzu result.
// Falls back to the direct address if Google asks for its own check or shows no result.
async function openFromGoogle(page, query, resultHref, log) {
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
    log('  Google did not lead to toolzu; opening it directly', 'warn')
    return false
  }
}

// Submits one post link to the tool and returns the image URLs it offers.
async function findImages(page, post, debugDir, { log, visible, google }) {
  const opened = google && (await openFromGoogle(page, 'toolzu instagram photo downloader', 'toolzu.com/downloader/instagram/photo', log))
  if (!opened) await page.goto(TOOL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 2000 }).catch(() => {})
  await page.fill('#instagramdownloaderform-search', post.url)
  await submitForm(page, '/downloader/instagram/photo', log, visible)
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
async function downloadProfile(page, profile, maxPages, handle, { log, visible, google }) {
  const opened = google && (await openFromGoogle(page, 'toolzu instagram profile', 'toolzu.com/downloader/instagram/profile', log))
  if (!opened) await page.goto(PROFILE_TOOL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Got it' }).click({ timeout: 2000 }).catch(() => {})
  if (!(await page.getByText('Logout').count())) log('  not signed in to toolzu: the profile tool may ask you to sign up', 'warn')
  await page.fill('#instagramdownloaderform-search', profile.url)
  await submitForm(page, '/downloader/instagram/profile', log, visible)
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
    log(`  loading batch ${n + 1} (${found.size} photos so far)`)
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
      .catch(() => log('  NEXT brought no new photos', 'warn'))
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
  if (!got) throw new TablefactsError('clicking Download started nothing', 'EFAILED')
  if (got.download) return got.download.saveAs(file)
  await got.tab.waitForURL((u) => u.toString() !== 'about:blank', { timeout: 15000 }).catch(() => {})
  const url = got.tab.url()
  await got.tab.close()
  if (page.url() !== before) throw new TablefactsError('the results page was left; Download navigated instead of saving', 'EFAILED')
  const res = await context.request.get(url)
  const bytes = await res.body()
  assertImageResponse({ ok: res.ok(), status: res.status(), contentType: res.headers()['content-type'], bytes })
  await writeImage(file, bytes)
}

async function saveUrl(url, file) {
  const res = await fetch(url)
  const bytes = Buffer.from(await res.arrayBuffer())
  assertImageResponse({ ok: res.ok, status: res.status, contentType: res.headers.get('content-type'), bytes })
  await writeImage(file, bytes)
}

/**
 * Downloads the photos of Instagram posts (and optionally a whole profile) through toolzu.com.
 * At least one of `links`, `file` or `profile` is required. Resolves to a summary whose `failed`
 * lists `{ item, reason }` and whose `found` is present only in a dry run. Throws a TablefactsError
 * on invalid arguments (code 'EUSAGE', with `option`), a missing playwright ('EDEPENDENCY') or a
 * browser that cannot be reached.
 * `out`, `file` and `userDataDir` resolve against `projectDir` (default: TABLEFACTS_PROJECT or the
 * current folder). `viaGoogle` reaches toolzu through a Google search. `log(message, level)` gets
 * level 'info', 'warn' or 'error'.
 * @param {import('../lib/types.mjs').InstagramOptions} options
 * @returns {Promise<import('../lib/types.mjs').PhotoSummary>}
 */
export async function downloadInstagram({
  links = [],
  file,
  out,
  profile,
  pages = 1,
  cdp,
  edgeDir,
  viaGoogle = false,
  browser,
  userDataDir,
  projectDir,
  headed = false,
  dryRun = false,
  debug = false,
  log: logOption,
} = {}) {
  const log = normalizeLog(logOption)
  if (!out) throw optionError('out', '`out` is required')
  const { posts, bad } = await readLinks(links, file && resolveIn(projectDir, file))
  for (const b of bad) log(`Skipping, not an Instagram post link: ${b}`, 'warn')
  const profileInfo = profile ? parseProfile(profile) : null
  if (profile && !profileInfo) throw optionError('profile', `\`profile\` is not an Instagram profile: ${profile}`)
  if (!posts.length && !profileInfo) throw optionError('links', 'no valid Instagram post links in `links`/`file`/`profile`')

  const { outDir, debugDir } = await prepareOut({ out, dryRun, debug, projectDir })
  const summary = newSummary({ dryRun })
  const visible = headed || Boolean(cdp) || viaGoogle
  // Through Google once, for the first page opened only; later ones open the tool directly.
  let usedGoogle = false
  const takeGoogle = () => viaGoogle && !usedGoogle && (usedGoogle = true)

  const { chromium } = await loadPlaywright()
  let context
  let close
  let page
  try {
    if (cdp) {
      // Your own browser: our tab is opened and closed here, the browser itself is left running.
      await ensureEdge(cdp, edgeDir)
      const connection = await chromium.connectOverCDP(cdp)
      context = connection.contexts()[0]
      close = async () => {
        try {
          await page?.close()
        } finally {
          await connection.close()
        }
      }
      page = await context.newPage()
    } else {
      // A persistent profile keeps cookies between runs, which helps with the Cloudflare check.
      context = await chromium.launchPersistentContext(resolveIn(projectDir, userDataDir ?? workDirIn(projectDir, 'instagram-profile')), {
        channel: browser,
        headless: !headed,
        args: ['--disable-blink-features=AutomationControlled'],
      })
      page = context.pages()[0] ?? (await context.newPage())
      close = () => context.close()
    }

    // Saves one image unless the file is already there (or only reports it in a dry run).
    // `link` is the locator of the card's own Download button, or null to fetch the URL directly.
    const store = (name, url, link) =>
      storeFile({
        outDir,
        name,
        url,
        dryRun,
        summary,
        log,
        save: ({ file }) => (link ? saveByClick(page, link, file) : saveUrl(url, file)),
      })

    if (profileInfo) {
      log(`Profile ${profileInfo.url}`)
      try {
        const maxPages = pages === 'all' ? Infinity : Math.max(1, Number(pages) || 1)
        const handle = async (cards) => {
          log(`  ${cards.length} photos`)
          for (const { url, index } of cards) {
            // The file name from Instagram is unique per photo, so a re-run skips what is saved.
            const stem = new URL(url).pathname.split('/').pop().replace(/\.\w+$/, '').replace(/_n$/, '')
            const name = `${profileInfo.user}-${stem}.jpg`
            const before = summary.saved
            // The card's own Download button, as a person clicks it.
            await store(name, url, page.locator('#ajax-results .download-card:has(.fa-image) a[download]').nth(index))
            if (summary.saved > before) await page.waitForTimeout(150)
          }
        }
        const seen = await downloadProfile(page, profileInfo, maxPages, handle, { log, visible, google: takeGoogle() })
        if (!seen) throw new TablefactsError('the tool returned no photos', 'EFAILED')
      } catch (err) {
        summary.failed.push({ item: profileInfo.url, reason: err.message })
        log(`  failed: ${err.message}`, 'error')
      }
    }

    for (const [i, post] of posts.entries()) {
      log(`[${i + 1}/${posts.length}] ${post.url}`)
      try {
        const images = await retry(
          async () => {
            const found = await findImages(page, post, debugDir, { log, visible, google: takeGoogle() })
            if (!found.length) throw new TablefactsError('the tool returned no images', 'EFAILED')
            return found
          },
          (err) => log(`  retrying (${err.message})`, 'warn'),
        )
        for (const [n, { url, index }] of images.entries()) {
          // The card's own Download button when we know which one it is, as a person clicks it.
          const link = index === null ? null : page.locator('#ajax-results a[download]').nth(index)
          await store(`${post.shortcode}-${n + 1}.jpg`, url, link)
        }
      } catch (err) {
        summary.failed.push({ item: post.url, reason: err.message })
        log(`  failed: ${err.message}`, 'error')
      }
      if (i < posts.length - 1) await page.waitForTimeout(DELAY_MS)
    }
  } finally {
    await close?.().catch(() => {})
  }
  return summary
}
