// The pure parts of download.mjs: reading the command line and the links it is given.
// Split out so they can be tested without starting a browser.

export function parseArgs(argv) {
  const opts = { links: [], headed: false, dryRun: false, debug: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i]
    else if (a === '--cdp') opts.cdp = argv[++i]
    else if (a === '--edge-dir') opts.edgeDir = argv[++i]
    else if (a === '--google') opts.google = true
    else if (a === '--file') opts.file = argv[++i]
    else if (a === '--browser') opts.browser = argv[++i]
    else if (a === '--profile') opts.profile = argv[++i]
    else if (a === '--user-data-dir') opts.userDataDir = argv[++i]
    else if (a === '--pages') opts.pages = argv[++i]
    else if (a === '--headed') opts.headed = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--debug') opts.debug = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`)
    else opts.links.push(a)
  }
  return opts
}

// Keeps only post and reel links and drops the tracking query, so duplicates collapse.
export function normalize(raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/(^|\.)instagram\.com$/.test(url.hostname)) return null
  const m = url.pathname.match(/\/(p|reel|reels|tv)\/([\w-]+)/)
  if (!m) return null
  return { shortcode: m[2], url: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/` }
}

// '@name', 'name' or a profile link -> { user, url }
export function parseProfile(raw) {
  let user = raw.trim()
  if (/^https?:/i.test(user)) {
    try {
      user = new URL(user).pathname.split('/').filter(Boolean)[0] ?? ''
    } catch {
      user = ''
    }
  }
  user = user.replace(/^@/, '')
  return /^[\w.]+$/.test(user) ? { user, url: `https://www.instagram.com/${user}/` } : null
}
