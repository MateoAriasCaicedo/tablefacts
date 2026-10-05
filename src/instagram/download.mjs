// Downloads the photos of Instagram posts through https://toolzu.com/downloader/instagram/photo/
// Usage: tablefacts photos instagram --out <folder> [--cdp <url>] [--profile <link|@name>] [--file links.txt] [link...]
// The work is in index.mjs (downloadInstagram); this file is only the command line.
import { TablefactsError, cliMessage, exitCodeFor } from '../lib/errors.mjs'
import { consoleLog } from '../lib/log.mjs'
import { downloadInstagram } from './index.mjs'
import { parseArgs } from './links.mjs'

const HELP = `Download Instagram post photos through toolzu.com.

  tablefacts photos instagram --out <folder> [options] [link...]

  --out <folder>   where the images are saved (required, created if missing)
  --file <path>    text file with one link per line (# comments and blank lines ignored)
  --cdp <url>      attach to Edge on this debugging address, e.g. http://localhost:9222. If nothing is
                   listening there the script starts Edge itself (the most reliable way past
                   toolzu's Cloudflare check)
  --edge-dir <dir> profile folder of that Edge, where the toolzu login is kept (default C:\ig-edge)
  --google         reach toolzu through a Google search, like a person would
  --browser <name> use an installed browser: msedge or chrome (default: bundled Chromium)
  --user-data-dir <dir>  browser profile kept between runs (default: .tablefacts/instagram-profile)
  --profile <link|@name> download the photos of a whole Instagram profile (videos are skipped);
                   needs a toolzu account signed in to the browser
  --pages <n|all>  with --profile, how many batches of posts to load with NEXT (default 1)
  --headed         show the browser (to watch, or to pass a challenge by hand)
  --dry-run        print the image URLs found, save nothing
  --debug          save the page HTML after each submit into <folder>/_debug
  --help           this text

Every link saves all the images of its post; ?img_index=N in a link is ignored.

Only download photos the restaurant owns or has allowed you to use.`

const FLAGS = {
  out: '--out <folder>',
  file: '--file',
  profile: '--profile',
  links: 'the links',
  cdp: '--cdp',
  debug: '--debug',
}

let summary
try {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (!opts.out) {
    console.error('Missing --out <folder>.\n\n' + HELP)
    process.exit(2)
  }
  summary = await downloadInstagram({ ...opts, log: consoleLog })
} catch (err) {
  if (!(err instanceof TablefactsError)) throw err
  console.error(cliMessage(err, FLAGS))
  process.exit(exitCodeFor(err))
}
console.log(`\nSaved ${summary.saved}, already there ${summary.skipped}, failed ${summary.failed.length}.`)
for (const f of summary.failed) console.log(`  ${f.item}: ${cliMessage({ message: f.reason }, FLAGS)}`)
process.exit(summary.failed.length ? 1 : 0)
