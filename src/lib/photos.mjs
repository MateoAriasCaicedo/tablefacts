// Scaffolding shared by the photo tools (Instagram, TripAdvisor).
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { exists } from './files.mjs'
import { resolveIn } from './project.mjs'

export const DELAY_MS = 2500

/** { saved, skipped, failed: [{ item, reason }], found? } where `found` ([{ name, url }]) exists only in a dry run. */
export function newSummary({ dryRun = false } = {}) {
  const summary = { saved: 0, skipped: 0, failed: [] }
  if (dryRun) summary.found = []
  return summary
}

/** Resolves the output folder and creates it (not in a dry run), plus <out>/_debug when `debug`. */
export async function prepareOut({ out, dryRun = false, debug = false, projectDir } = {}) {
  const outDir = resolveIn(projectDir, out)
  if (!dryRun) await mkdir(outDir, { recursive: true })
  const debugDir = debug ? join(outDir, '_debug') : null
  if (debugDir) await mkdir(debugDir, { recursive: true })
  return { outDir, debugDir }
}

/**
 * Dry run: records { name, url } in summary.found. File already there: counts it as skipped.
 * Otherwise awaits `save({ file, name, url })` and counts it as saved. A save error is not caught.
 */
export async function storeFile({ outDir, name, url, dryRun, summary, log, save }) {
  const file = join(outDir, name)
  if (dryRun) {
    summary.found.push({ name, url })
    log(`  ${name} <- ${url}`)
  } else if (await exists(file)) {
    summary.skipped++
    log(`  ${name} already there`)
  } else {
    await save({ file, name, url })
    summary.saved++
    log(`  ${name} saved`)
  }
}
