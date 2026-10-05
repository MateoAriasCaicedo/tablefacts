// Attaches to the user's own Edge window over the DevTools protocol, starting it when needed.
// Shared by the tools that drive a real browser (photos instagram, photos tripadvisor).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULT_CDP = 'http://localhost:9222'
export const DEFAULT_EDGE_DIR = 'C:\\ig-edge'

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/**
 * Whether a browser answers on the DevTools address.
 * @param {string} cdp e.g. http://localhost:9222
 * @returns {Promise<boolean>}
 */
export async function cdpUp(cdp) {
  try {
    return (await fetch(new URL('/json/version', cdp), { signal: AbortSignal.timeout(2000) })).ok
  } catch {
    return false
  }
}

// Starts Edge with remote debugging when nothing answers on the `cdp` address (local only).
// It is detached, so it stays open after the run and keeps its logins for the next one.
/**
 * @param {string} cdp DevTools address; only localhost can be started
 * @param {string} [edgeDir] Edge profile folder. Default C:\ig-edge
 * @returns {Promise<void>}
 */
export async function ensureEdge(cdp, edgeDir) {
  if (await cdpUp(cdp)) return
  const url = new URL(cdp)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`no browser answers at ${cdp}`)
  const exe = EDGE_PATHS.find((path) => existsSync(path))
  if (!exe) throw new Error('Edge was not found in its usual folder; start it yourself with --remote-debugging-port')
  const dir = resolve(edgeDir ?? DEFAULT_EDGE_DIR)
  console.log(`Starting Edge on port ${url.port} (profile ${dir})`)
  spawn(exe, [`--remote-debugging-port=${url.port}`, `--user-data-dir=${dir}`], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 30; i++) {
    await new Promise((done) => setTimeout(done, 1000))
    if (await cdpUp(cdp)) return
  }
  throw new Error('Edge did not open its debugging port; close the Edge window that uses that profile and run again')
}
