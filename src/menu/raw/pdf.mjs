// Reads a PDF menu. A digital PDF carries its text, so a page is transcribed
// from that; a scanned page has no text and is rendered to a picture for the
// vision model. The same render lets a product's printed photo be screenshotted:
// pdfjs records where every image lands on the page while rendering
// (`recordImages`), and that rectangle is cropped out of the page render.
//
// pdfjs-dist is optional and loads through pdfjs.mjs. See raw/README in
// src/menu/README.md for how the pages flow through the importer.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TablefactsError } from "../../lib/errors.mjs";
import { resolveIn } from "../../lib/project.mjs";
import { get } from "./source.mjs";
import { loadPdfjs, renderError } from "./pdfjs.mjs";

// A menu PDF is small; this keeps a stray file from filling memory. The vision
// providers cap a picture at 5 MB, which a rendered page respects by itself.
const MAX_BYTES = 25 * 1024 * 1024;
// A PDF can declare a huge MediaBox; rendering it at `scale` would allocate an
// enormous canvas, so the scale is reduced to stay under this many pixels.
const MAX_RENDER_PIXELS = 30_000_000;
const PDF_MAGIC = "%PDF-";

const hasPdfMagic = (bytes) => bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === PDF_MAGIC;

/**
 * True when an argument names a PDF: a local file ending in .pdf, or a URL whose
 * path ends in .pdf. A URL that hides the extension comes back from the fetch as
 * an HTML page with no pictures, and the reader says to pass the file instead.
 * @param {string} input
 * @returns {boolean}
 */
export function isPdfInput(input) {
  try {
    return /\.pdf$/i.test(new URL(input).pathname);
  } catch {
    return /\.pdf$/i.test(String(input).split(/[\\/]/).pop() ?? "");
  }
}

/**
 * The PDF's bytes, from a local file (`projectDir`-relative) or an http(s) URL.
 * `host` names the cache folder, `label` is what a note calls the file.
 * @param {string} input
 * @param {{ projectDir?: string }} [options]
 * @returns {Promise<{ bytes: Uint8Array, host: string, label: string }>}
 */
export async function readPdfSource(input, { projectDir } = {}) {
  // `new URL` accepts "C:\path" as a `c:` URL, so only http(s)/file are treated
  // as URLs; anything else is a filesystem path.
  let url = null;
  try {
    const parsed = new URL(input);
    if (/^(https?|file):$/.test(parsed.protocol)) url = parsed;
  } catch {
    url = null;
  }
  if (!url && /^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    throw new TablefactsError(`"${input}" is not an http(s) URL or a file path.`, "EUSAGE");
  }
  if (url?.protocol === "file:") return readLocalPdf(fileURLToPath(url));
  if (url) {
    const res = await get(input, "PDF");
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const declared = Number(res.headers.get("content-length"));
    if (declared > MAX_BYTES) throw new TablefactsError(`${input} is ${(declared / 1048576).toFixed(1)} MB; menu PDFs are limited to 25 MB.`, "EFAILED");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!type.includes("pdf") && !hasPdfMagic(bytes)) {
      throw new TablefactsError(`${input} is ${type || "not a PDF"}: this source reads PDFs and web pages, not other files.`, "EFAILED");
    }
    if (bytes.length > MAX_BYTES) throw new TablefactsError(`${input} is ${(bytes.length / 1048576).toFixed(1)} MB; menu PDFs are limited to 25 MB.`, "EFAILED");
    return { bytes, host: url.hostname, label: input };
  }

  return readLocalPdf(resolveIn(projectDir, input));
}

/** The bytes of a local PDF, with the magic-bytes and size checks in one place. */
async function readLocalPdf(file) {
  const bytes = new Uint8Array(
    await readFile(file).catch((error) => {
      throw new TablefactsError(`Could not read ${file}: ${error.message}.`, "EUSAGE", { cause: error });
    }),
  );
  if (!hasPdfMagic(bytes)) throw new TablefactsError(`${file} is not a PDF.`, "EUSAGE");
  if (bytes.length > MAX_BYTES) throw new TablefactsError(`${file} is ${(bytes.length / 1048576).toFixed(1)} MB; menu PDFs are limited to 25 MB.`, "EUSAGE");
  return { bytes, host: "local", label: file };
}

/**
 * Opens a PDF for reading. `close()` releases pdfjs's worker; call it when the
 * run is done with the file. `textCache` keeps a page's text from being read twice.
 * @param {Uint8Array} bytes
 * @returns {Promise<any>} the open document handle
 */
export async function openPdf(bytes) {
  const { pdfjs, standardFontDataUrl, cMapUrl } = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy().catch(() => {});
    if (error?.name === "PasswordException") throw new TablefactsError("The PDF is password-protected. Remove the password and try again.", "EFAILED", { cause: error });
    throw new TablefactsError(`The PDF could not be opened: ${error?.message ?? error}.`, "EFAILED", { cause: error });
  }
  const ops = Object.fromEntries(Object.entries(pdfjs.OPS).map(([name, code]) => [code, name]));
  return {
    pdfjs,
    doc,
    numPages: doc.numPages,
    ops,
    textCache: new Map(),
    opened: new Map(),
    close: () => task.destroy().catch(() => {}),
  };
}

const openPage = async (source, number) => {
  if (!source.opened.has(number)) source.opened.set(number, source.doc.getPage(number));
  return source.opened.get(number);
};

/**
 * One page's text and its pieces. `items` are pdfjs's text items, kept for
 * matching a product name to a spot on the page when placing product photos.
 * @returns {Promise<{ page: any, text: string, items: any[] }>}
 */
export async function readPdfText(source, number) {
  if (source.textCache.has(number)) return source.textCache.get(number);
  const page = await openPage(source, number);
  const content = await page.getTextContent();
  const items = content.items.filter((item) => typeof item.str === "string");
  const result = { page, text: textFromItems(items), items };
  source.textCache.set(number, result);
  return result;
}

/** Every page that has text worth transcribing, and how much. Used by `--list`. */
export async function inspectPdf(source) {
  const pages = [];
  for (let number = 1; number <= source.numPages; number++) {
    const { text } = await readPdfText(source, number);
    pages.push({ number, hasText: text.trim().length > 0, chars: text.trim().length });
  }
  return pages;
}

/**
 * The text items flattened to `{ str, x, y, width, height }`, which both the
 * text builder and the product-photo matcher understand.
 */
export const positionedItems = (items) =>
  (items ?? [])
    .filter((item) => typeof item.str === "string" && item.str.trim() !== "")
    .map((item) => {
      const transform = item.transform ?? [];
      return {
        str: item.str,
        x: item.x ?? transform[4] ?? 0,
        y: item.y ?? transform[5] ?? 0,
        width: Math.abs(item.width ?? 0),
        height: Math.abs(item.height ?? 0) || Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || 10,
      };
    });

/**
 * Rebuilds readable text from pdfjs text items: pieces on the same line are
 * joined in reading order, a wide vertical gap becomes a blank line so the model
 * still sees section breaks. A page with two clear columns is read column by
 * column, so the two columns' rows are not merged. Pure, so it is tested without
 * a PDF.
 * @param {{ str?: string, transform?: number[], width?: number, height?: number }[]} items
 * @returns {string}
 */
export function textFromItems(items) {
  const pieces = positionedItems(items).sort((a, b) => b.y - a.y || a.x - b.x);
  const columns = splitColumns(pieces);
  if (columns) return columns.map((column) => assemble(column)).filter(Boolean).join("\n\n");
  return assemble(pieces);
}

const hasLetter = (text) => /\p{L}/u.test(text);
const hasDigit = (text) => /\d/.test(text);

/**
 * Two columns when a wide vertical corridor splits the text and both sides look
 * like a menu column (left-aligned, with headings and with prices). A single
 * column that right- or left-aligns its prices has a corridor too, but then one
 * side holds only prices, so it is not a column and the text is left alone.
 * Returns [left, right] or null.
 */
function splitColumns(pieces) {
  if (pieces.length < 6) return null;
  const minX = Math.min(...pieces.map((piece) => piece.x));
  const maxX = Math.max(...pieces.map((piece) => piece.x + piece.width));
  const width = maxX - minX;
  if (width <= 0) return null;

  const intervals = pieces.map((piece) => [piece.x, piece.x + piece.width]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const threshold = Math.max(width * 0.05, 24);
  let corridor = null;
  for (let i = 0; i + 1 < merged.length; i++) {
    const gap = merged[i + 1][0] - merged[i][1];
    if (gap >= threshold && (!corridor || gap > corridor.gap)) corridor = { gap, at: merged[i][1] + gap / 2 };
  }
  if (!corridor) return null;

  const left = pieces.filter((piece) => piece.x + piece.width <= corridor.at);
  const right = pieces.filter((piece) => piece.x >= corridor.at);
  const enough = [left, right].every((side) => side.length >= Math.max(3, pieces.length * 0.25));
  if (!enough) return null;
  const isColumn = (side) => {
    const starts = side.map((piece) => piece.x);
    const ends = side.map((piece) => piece.x + piece.width);
    const spread = Math.max(...starts) - Math.min(...starts);
    const span = Math.max(...ends) - Math.min(...starts) || 1;
    return spread <= span * 0.5 && side.some((piece) => hasLetter(piece.str) && !hasDigit(piece.str)) && side.some((piece) => hasDigit(piece.str));
  };
  return isColumn(left) && isColumn(right) ? [left, right] : null;
}

/** One column (or a single-column page) as lines, top to bottom. */
function assemble(pieces) {
  const sorted = pieces.slice().sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const piece of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - piece.y) <= Math.max(last.h, piece.height) * 0.6) {
      last.parts.push(piece);
      last.y = (last.y * (last.parts.length - 1) + piece.y) / last.parts.length;
      last.h = Math.max(last.h, piece.height);
    } else {
      lines.push({ y: piece.y, h: piece.height, parts: [piece] });
    }
  }
  if (!lines.length) return "";

  const heights = lines.map((line) => line.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 10;
  let out = "";
  let previous = null;
  for (const line of lines) {
    const text = line.parts
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((part) => part.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (previous && previous.y - line.y > median * 1.8) out += "\n";
    out += `${text}\n`;
    previous = line;
  }
  return out.trimEnd();
}

/** A page's rendered pixels, the context, and the viewport they were rendered with. */
export async function renderPdfPage(source, page, { scale = 2, recordImages = false } = {}) {
  let viewport = page.getViewport({ scale });
  // A page with a huge MediaBox would allocate an enormous canvas: cap the
  // pixels and render smaller, so a stray PDF cannot exhaust memory.
  const pixels = viewport.width * viewport.height;
  if (pixels > MAX_RENDER_PIXELS) {
    scale *= Math.sqrt(MAX_RENDER_PIXELS / pixels);
    viewport = page.getViewport({ scale });
  }
  try {
    const { canvas, context } = source.doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height), false);
    await page.render({ canvas, canvasContext: context, viewport, recordImages }).promise;
    return { canvas, context, viewport, scale };
  } catch (error) {
    throw renderError(error);
  }
}

/** Releases a rendered canvas's native memory. */
export function destroyPage(source, { canvas, context } = {}) {
  if (canvas) source.doc.canvasFactory.destroy({ canvas, context });
}

/**
 * The rectangle each image occupies on a page render. pdfjs records this itself
 * when rendering with `recordImages` (three points per image, fractions of the
 * canvas, top-left origin): it is clip- and group-aware, unlike walking the
 * operator list by hand.
 */
export function imageRects(canvas, coordinates) {
  const out = [];
  const coords = coordinates ?? [];
  for (let i = 0; i + 5 < coords.length; i += 6) {
    const xs = [coords[i] * canvas.width, coords[i + 2] * canvas.width, coords[i + 4] * canvas.width];
    const ys = [coords[i + 1] * canvas.height, coords[i + 3] * canvas.height, coords[i + 5] * canvas.height];
    const left = Math.max(0, Math.min(...xs));
    const top = Math.max(0, Math.min(...ys));
    const right = Math.min(canvas.width, Math.max(...xs));
    const bottom = Math.min(canvas.height, Math.max(...ys));
    if (right - left >= 1 && bottom - top >= 1) out.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return out;
}

/** Crops a pixel rectangle out of a page render, as a PNG buffer. */
export function cropPdfPixels(source, canvas, { x, y, width, height }, { padding = 0 } = {}) {
  const left = Math.max(0, Math.floor(x) - padding);
  const top = Math.max(0, Math.floor(y) - padding);
  const w = Math.max(1, Math.min(canvas.width - left, Math.ceil(width) + padding * 2));
  const h = Math.max(1, Math.min(canvas.height - top, Math.ceil(height) + padding * 2));
  const { canvas: out, context } = source.doc.canvasFactory.create(w, h, false);
  context.drawImage(canvas, left, top, w, h, 0, 0, w, h);
  const png = out.toBuffer("image/png");
  source.doc.canvasFactory.destroy({ canvas: out, context });
  return png;
}
