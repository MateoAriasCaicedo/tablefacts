import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { TablefactsError } from './errors.mjs'

/** Throws EFAILED unless the response is a good image: ok, an image/* content type and at least `minBytes` bytes. */
export function assertImageResponse({ ok, status, contentType, bytes, minBytes = 0, label } = {}) {
  const fail = (text) => {
    throw new TablefactsError(label ? `${label}: ${text}` : text, 'EFAILED')
  }
  if (!ok) fail(`HTTP ${status}`)
  const type = contentType ?? ''
  if (!type.startsWith('image/')) fail(type ? `not an image (${type})` : 'not an image')
  if (minBytes > 0 && (bytes?.length ?? 0) < minBytes) fail('too small')
}

/** Writes the bytes to `file`, creating its folder first. */
export async function writeImage(file, bytes) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes)
}
