// Finds the menu pages of a restaurant whose menu is only pictures (a gallery
// of JPGs on a WordPress page, a menu photographed page by page) and downloads
// them. Nothing here is specific to one site: it takes the large images of a
// page's HTML in document order. Sites that load their pictures from
// JavaScript show up as "no images": pass the image URLs directly instead.
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TablefactsError } from "../../lib/errors.mjs";
import { workDirIn } from "../../lib/project.mjs";

const headers = { "user-agent": "cannario-menu-sync/1.0 (restaurant menu importer)" };
const IMAGE = /\.(jpe?g|png|webp)(\?|$)/i;
const MAX_BYTES = 5 * 1024 * 1024; // the Claude API refuses larger images; Gemini and Groq take 20 MB, so this is the tightest limit

/** A fetch with retries on server errors; shared with the PDF reader. */
export async function get(url, what) {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res;
      failure = Object.assign(new TablefactsError(`HTTP ${res.status} fetching ${what} ${url}`, "EFAILED"), { status: res.status });
      if (res.status < 500) break;
    } catch (error) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw failure;
}

const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v !== undefined);

/** WordPress serves "name-600x1199.jpg" next to the original "name.jpg": ask for the original. */
const original = (url) => url.replace(/-\d{2,4}x\d{2,4}(\.\w+)(\?|$)/, "$1$2");

/**
 * The picture URLs of a page, in document order. Lazy-loaders keep the real
 * address in data-orig-src / data-src and put a placeholder in src, so those
 * come first. Images declaring a width under `minWidth` (logos, icons) and
 * anything that is not a JPG, PNG or WebP (SVG logos) are skipped.
 */
export function findImages(html, pageUrl, { minWidth = 500 } = {}) {
  const found = new Map();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const raw = [attribute(tag, "data-orig-src"), attribute(tag, "data-src"), attribute(tag, "src")].find((v) => v && !v.startsWith("data:"));
    if (!raw) continue;
    let url;
    try {
      url = original(new URL(raw.replace(/&amp;/g, "&"), pageUrl).href);
    } catch {
      continue;
    }
    if (!IMAGE.test(url)) continue;
    const width = Number(attribute(tag, "width"));
    if (width && width < minWidth) continue;
    if (!found.has(url)) found.set(url, { url, alt: attribute(tag, "alt") ?? "" });
  }
  return [...found.values()];
}

/** Each argument is a page to scan or a direct image URL. */
export async function discoverPages(inputs, options) {
  for (const input of inputs) {
    try {
      new URL(input);
    } catch {
      throw new TablefactsError(`"${input}" is not a URL.`, "EUSAGE");
    }
  }
  const found = await Promise.allSettled(
    inputs.map(async (input) => {
      if (IMAGE.test(new URL(input).pathname)) return [{ url: input, alt: "" }];
      const res = await get(input, "page");
      // The argument was not seen as a PDF (its address does not end in .pdf):
      // say so instead of reporting "no images".
      if ((res.headers.get("content-type") ?? "").toLowerCase().includes("pdf")) {
        throw new TablefactsError(`${input} serves a PDF whose address does not end in .pdf. Download it and pass the file instead.`, "EFAILED");
      }
      const html = await res.text();
      const images = findImages(html, input, options);
      if (!images.length) {
        throw new TablefactsError(
          `No menu images found in ${input} (looked for JPG, PNG or WebP at least ${options?.minWidth ?? 500}px wide).\n` +
            "If the page loads its pictures with JavaScript, open it, copy the image addresses and pass them instead; use `minWidth` to lower the size filter.",
          "EFAILED",
        );
      }
      return images;
    }),
  );
  const failed = found.find((r) => r.status === "rejected");
  if (failed) throw failed.reason; // the first input's failure, whichever finished first
  return found.flatMap((r) => r.value);
}

export const pageId = (url) => createHash("sha1").update(url).digest("hex").slice(0, 10);

/** Downloads one page image into the cache (once) and returns where it is and what it is. */
export async function downloadPage(page, host, { projectDir } = {}) {
  const dir = join(workDirIn(projectDir, "cache"), host);
  await mkdir(dir, { recursive: true });
  const id = pageId(page.url);
  const meta = join(dir, `${id}.type`);
  const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  // The saved media type names the extension, so a cache hit is one read and one access check.
  const saved = await readFile(meta, "utf8").catch(() => null);
  if (saved && types[saved]) {
    const known = join(dir, `${id}.${types[saved]}`);
    if (await access(known).then(() => true, () => false)) return { id, dir, file: known, mediaType: saved };
  }

  const res = await get(page.url, "image");
  const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!types[mediaType]) throw new TablefactsError(`${page.url} is ${mediaType || "of unknown type"}, not a JPG, PNG or WebP image.`, "EFAILED");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new TablefactsError(`${page.url} is ${(bytes.length / 1048576).toFixed(1)} MB; menu pages are limited to 5 MB so that every provider can read them. Save a smaller copy.`, "EFAILED");
  const file = join(dir, `${id}.${types[mediaType]}`);
  await writeFile(file, bytes);
  await writeFile(meta, mediaType);
  return { id, dir, file, mediaType };
}
