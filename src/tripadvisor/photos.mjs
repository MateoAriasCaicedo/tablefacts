// Downloads the photos of a restaurant's TripAdvisor page, in the user's own Edge window.
// Usage: tablefacts photos tripadvisor --out <folder> [--cdp <url>] <restaurant link>...
// The work is in index.mjs (downloadTripadvisor); this file is only the command line.
import { TablefactsError, cliMessage, exitCodeFor } from '../lib/errors.mjs'
import { consoleLog } from '../lib/log.mjs'
import { downloadTripadvisor } from './index.mjs'
import { parseArgs } from './links.mjs'

const HELP = `Download the photos of a restaurant's TripAdvisor page.

  tablefacts photos tripadvisor --out <folder> [options] <restaurant link>...

  --out <folder>   where the images are saved (required, created if missing)
  --cdp <url>      attach to Edge on this debugging address (default http://localhost:9222). If nothing
                   is listening there the script starts Edge itself
  --edge-dir <dir> profile folder of that Edge (default C:\\ig-edge, shared with photos instagram)
  --max <n>        stop after n photos per restaurant (default: all it can reach)
  --dry-run        print the photo URLs found, save nothing
  --debug          save the page HTML into <folder>/_debug, to fix the selectors
  --help           this text

The link is the restaurant's page, like https://www.tripadvisor.com/Restaurant_Review-g297478-d123-Reviews-Name.html
TripAdvisor shows a "verify you are human" check to automated browsers: if it appears in the window,
tick it yourself. This script waits for it and never tries to get around it.

Only download photos the restaurant owns or has allowed you to use. Most photos on TripAdvisor were
uploaded by guests, who keep the rights to them.`

const FLAGS = {
  out: '--out <folder>',
  links: 'the arguments',
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
  summary = await downloadTripadvisor({ ...opts, log: consoleLog })
} catch (err) {
  if (!(err instanceof TablefactsError)) throw err
  console.error(cliMessage(err, FLAGS))
  process.exit(exitCodeFor(err))
}
console.log(`\nSaved ${summary.saved}, already there ${summary.skipped}, failed ${summary.failed.length}.`)
for (const f of summary.failed) console.log(`  ${f.item}: ${cliMessage({ message: f.reason }, FLAGS)}`)
process.exit(summary.failed.length ? 1 : 0)
