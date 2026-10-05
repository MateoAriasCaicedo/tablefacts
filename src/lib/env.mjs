// Reads KEY=value env files into process.env without overriding what is already set.
import { existsSync, readFileSync } from 'node:fs'
import { envFiles } from './project.mjs'

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

/** Loads `files` (default: the project's .env files). The first file that sets a variable wins. */
export function loadEnvFiles(files = envFiles()) {
  for (const file of files) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(LINE)
      if (!m || line.trim().startsWith('#') || m[1] in process.env) continue
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}
