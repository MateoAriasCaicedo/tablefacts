// The pure parts of photos.mjs: the command line, the restaurant link and the photo URLs.
// Split out so they can be tested without starting a browser.

export function parseArgs(argv) {
  const opts = { links: [], dryRun: false, debug: false, max: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--cdp') opts.cdp = argv[++i]
    else if (a === '--edge-dir') opts.edgeDir = argv[++i]
    else if (a === '--max') {
      opts.max = Number(argv[++i])
      if (!(opts.max > 0)) throw new Error('--max needs a number above 0')
    } else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--debug') opts.debug = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else opts.links.push(a)
  }
  return opts
}

// A restaurant page looks like /Restaurant_Review-g297478-d1234567-Reviews-Name-City.html on
// any country domain (tripadvisor.com, .co, .es...). The query and hash are dropped, so the same
// restaurant gives one URL.
export function normalizeRestaurant(raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/(^|\.)tripadvisor\.[a-z.]+$/.test(url.hostname)) return null
  const m = url.pathname.match(/\/Restaurant_Review-g\d+-(d\d+)[^/]*\.html$/)
  if (!m) return null
  return { id: m[1], url: `${url.origin}${url.pathname}` }
}

const MEDIA = /https?:\/\/(?:dynamic-media-cdn|media-cdn)\.tripadvisor\.com\/media\/photo-([a-z])\/(?:\d{3,}\/)?([\w-]+(?:\/[\w-]+){2,5}\/[^\s"'\\)?<>]+?\.(?:jpe?g|png|webp))/gi

// Page HTML often carries URLs inside JSON, with slashes escaped as \/ or \u002F.
function unescape(text) {
  return text.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&')
}

// Every TripAdvisor photo URL in some text, once per photo (the same photo appears in several
// sizes: photo-s, photo-l, photo-o...). Reviewer avatars, maps and logos are left out.
// Returns [{ key, size, url }] in the order first seen; `key` is the path after the size.
export function findPhotos(text) {
  const found = new Map()
  for (const m of unescape(text).matchAll(MEDIA)) {
    const [url, size, key] = m
    if (/avatar|\/map|logo/i.test(key)) continue
    if (!found.has(key)) found.set(key, { key, size, url })
  }
  return [...found.values()]
}

// Candidate URLs for one photo, biggest first: the original, then the next sizes, then the size the
// page itself showed. Not every size exists for every photo, so the caller tries them in turn.
export function sizeCandidates(photo) {
  const base = 'https://dynamic-media-cdn.tripadvisor.com/media'
  const urls = ['o', 'w', 'l'].map((size) => `${base}/photo-${size}/${photo.key}`)
  const own = photo.url.replace(/\?.*$/, '')
  if (!urls.includes(own)) urls.push(own)
  return urls
}

// '1a/2b/3c/4d/name.jpg' -> '1a2b3c4d-name.jpg': unique per photo and stable between runs.
export function fileName(photo) {
  const parts = photo.key.split('/')
  const name = parts.pop()
  const ext = (name.match(/\.(jpe?g|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg')
  const stem = name.replace(/\.\w+$/, '')
  return `${parts.join('')}-${stem}.${ext}`.replace(/[^\w.-]/g, '_')
}
