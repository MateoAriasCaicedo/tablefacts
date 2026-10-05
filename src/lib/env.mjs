// Reads KEY=value env files into an env object (process.env by default) without overriding what is already set.
import { existsSync, readFileSync } from 'node:fs'
import { envFiles } from './project.mjs'

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/

/** `env` when given, else process.env. */
export const resolveEnv = (env) => env ?? process.env

/** Loads `files` (default: the project's .env files) into `env`. The first file that sets a variable wins. Returns the files it read. */
export function loadEnvFiles(files = envFiles(), env = process.env) {
  const target = resolveEnv(env)
  const read = []
  for (const file of files) {
    if (!existsSync(file)) continue
    read.push(file)
    for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(LINE)
      if (!m || line.trim().startsWith('#') || m[1] in target) continue
      target[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return read
}

/**
 * Loads the project's env files (`projectDir`, else TABLEFACTS_PROJECT or the current folder) or
 * exactly `files` into `env` (default process.env). Never overrides a variable that is already set.
 * Returns the files it read.
 * @param {import('./types.mjs').LoadEnvOptions} [options]
 * @returns {string[]}
 */
export function loadEnv({ projectDir, files, env = process.env } = {}) {
  return loadEnvFiles(files ?? envFiles(projectDir), env)
}
