// Finds the menu pages of a restaurant whose menu is only pictures (a gallery
// of JPGs on a WordPress page, a menu photographed page by page) and downloads
// them. Nothing here is specific to one site: it takes the large images of a
// page's HTML in document order. Sites that load their pictures from
// JavaScript show up as "no images": pass the image URLs directly instead.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workDir } from "../../lib/project.mjs";

export const cacheRoot = workDir("cache");

const headers = { "user-agent": "cannario-menu-sync/1.0 (restaurant menu importer)" };
const IMAGE = /\.(jpe?g|png|webp)(\?|$)/i;
const MAX_BYTES = 5 * 1024 * 1024; // the Claude API refuses larger images; Gemini and Groq take 20 MB, so this is the tightest limit

async function get(url, what) {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res;
      failure = Object.assign(new Error(`HTTP ${res.status} fetching ${what} ${url}`), { status: res.status });
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
  const pages = [];
  for (const input of inputs) {
    try {
      new URL(input);
    } catch {
      throw new Error(`"${input}" is not a URL.`);
    }
    if (IMAGE.test(new URL(input).pathname)) {
      pages.push({ url: input, alt: "" });
      continue;
    }
    const html = await (await get(input, "page")).text();
    const images = findImages(html, input, options);
    if (!images.length) {
      throw new Error(
        `No menu images found in ${input} (looked for JPG, PNG or WebP at least ${options?.minWidth ?? 500}px wide).\n` +
          "If the page loads its pictures with JavaScript, open it, copy the image addresses and pass them instead; use --min-width to lower the size filter.",
      );
    }
    pages.push(...images);
  }
  return pages;
}

export const pageId = (url) => createHash("sha1").update(url).digest("hex").slice(0, 10);

/** Downloads one page image into the cache (once) and returns where it is and what it is. */
export async function downloadPage(page, host) {
  const dir = join(cacheRoot, host);
  mkdirSync(dir, { recursive: true });
  const id = pageId(page.url);
  const meta = join(dir, `${id}.type`);
  const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const known = ["jpg", "png", "webp"].map((ext) => join(dir, `${id}.${ext}`)).find(existsSync);
  if (known && existsSync(meta)) return { id, dir, file: known, mediaType: readFileSync(meta, "utf8") };

  const res = await get(page.url, "image");
  const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!types[mediaType]) throw new Error(`${page.url} is ${mediaType || "of unknown type"}, not a JPG, PNG or WebP image.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`${page.url} is ${(bytes.length / 1048576).toFixed(1)} MB; menu pages are limited to 5 MB so that every provider can read them. Save a smaller copy.`);
  const file = join(dir, `${id}.${types[mediaType]}`);
  writeFileSync(file, bytes);
  writeFileSync(meta, mediaType);
  return { id, dir, file, mediaType };
}
