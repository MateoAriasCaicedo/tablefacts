// Menus that are only pictures or a PDF, as a library: find the pages, have a
// model transcribe them (a PDF page from its text, a picture or scan with a
// vision model), normalize and import. Product photos printed on a PDF page are
// screenshotted too, when asked for.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveEnv } from "../../lib/env.mjs";
import { optionError, TablefactsError } from "../../lib/errors.mjs";
import { normalizeLog } from "../../lib/log.mjs";
import { resolveIn, workDirIn } from "../../lib/project.mjs";
import { importMenu } from "../lib/import.mjs";
import { slugify } from "../lib/menu.mjs";
import defaultConfig from "./config.mjs";
import { matchPlacements } from "./images.mjs";
import { normalizePages } from "./normalize.mjs";
import {
  cropPdfPixels,
  destroyPage,
  imageRects,
  inspectPdf,
  isPdfInput,
  openPdf,
  positionedItems,
  readPdfSource,
  readPdfText,
  renderPdfPage,
} from "./pdf.mjs";
import { discoverPages, downloadPage, pageId } from "./source.mjs";
import { defaultProvider, providers, readPage, readText } from "./vision.mjs";

const providerNames = Object.keys(providers).join(", ");
// A page with fewer characters than this is a page number or a logo, not a menu:
// it is read as a picture instead (a scanned page often has a stray text layer).
const MIN_PAGE_TEXT = 40;

/** True when a transcription was read with photo boxes: every item then carries a `box` key (often null). A page read as having no items needs no re-read. */
const hasBoxField = (transcription) => {
  const items = (transcription.sections ?? []).flatMap((section) => section.items ?? []);
  return items.length === 0 || items.some((item) => item && Object.hasOwn(item, "box"));
};

/** A page longer than this is truncated before the model sees it, to bound cost. */
const MAX_PAGE_TEXT = 20000;
/** The tightest vision limit across providers; a bigger page render must be lowered. */
const MAX_PAGE_IMAGE = 5 * 1024 * 1024;

/** Text items moved from PDF user space into the render's pixel space, so they and the crop rectangles can be compared. */
const canvasItems = (items, viewport) => {
  const [a, b, c, d, e, f] = viewport.transform;
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  return items.map((item) => ({
    str: item.str,
    x: a * item.x + c * item.y + e,
    y: b * item.x + d * item.y + f,
    width: item.width * scaleX,
    height: item.height * scaleY,
  }));
};

/** "1,3-5" (or a list of numbers) to Set {1,3,4,5}. */
function pageSet(only) {
  if (Array.isArray(only)) return new Set(only.map(Number));
  const wanted = new Set();
  for (const part of String(only).split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw optionError("only", `\`only\` "${only}" is not a list of pages such as 1,3-5.`);
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) wanted.add(n);
  }
  return wanted;
}

/**
 * Every page found, and the numbered ones `only` selects. A PDF argument
 * contributes one page per PDF page; anything else is scanned for menu pictures.
 * `close()` releases the open PDFs.
 */
export async function findPages({ urls = [], only, minWidth = 500, projectDir, config = defaultConfig } = {}) {
  if (!urls.length && !config.url) throw new TablefactsError("No menu page to read: pass urls, or set url in the raw menu config.", "ECONFIG");
  const inputs = urls.length ? urls : [config.url];
  const pages = [];
  const sources = [];
  const close = async () => {
    for (const source of sources) await source.close();
  };
  try {
    // Consecutive web/image arguments are fetched together (discoverPages runs
    // them in parallel); PDFs in between are opened in order.
    const web = [];
    const flushWeb = async () => {
      if (!web.length) return;
      for (const image of await discoverPages([...web], { minWidth: Number(minWidth) })) pages.push({ kind: "image", ...image });
      web.length = 0;
    };
    for (const input of inputs) {
      if (isPdfInput(input)) {
        await flushWeb();
        const { bytes, host, label } = await readPdfSource(input, { projectDir });
        const source = await openPdf(bytes);
        sources.push(source);
        for (const info of await inspectPdf(source)) {
          pages.push({ kind: "pdf", source, host, label, pageNumber: info.number, url: `${label}#${info.number}`, chars: info.chars });
        }
      } else {
        web.push(input);
      }
    }
    await flushWeb();
  } catch (error) {
    await close();
    throw error;
  }
  const numbered = pages.map((page, i) => ({ ...page, number: i + 1 }));
  const wanted = only === undefined || only === "" ? null : pageSet(only);
  const chosen = numbered.filter((page) => !wanted || wanted.has(page.number));
  if (!chosen.length) {
    await close();
    throw optionError("only", `\`only\` ${only} matches none of the ${numbered.length} pages found.`);
  }
  return { pages: numbered, chosen, close };
}

/**
 * The pages `--list` prints, numbered, including PDF pages with their text size.
 * @param {import('../../lib/types.mjs').ListMenuImagesOptions} [options]
 * @returns {Promise<import('../../lib/types.mjs').MenuImage[]>}
 */
export async function listMenuImages(options = {}) {
  const found = await findPages(options);
  try {
    return found.chosen.map((page) =>
      page.kind === "pdf"
        ? { number: page.number, url: page.url, alt: "", kind: "pdf", chars: page.chars }
        : { number: page.number, url: page.url, alt: page.alt ?? "", kind: "image" },
    );
  } finally {
    await found.close();
  }
}

/** A crop of the page render tied to a page number; `id` makes it unique in a run. */
const crop = (id, png, extra = {}) => ({ id, png, ...extra });

/**
 * The images placed on a digital PDF page, as crops of its render, filtered
 * against the page size so icons and a full-page background are left out.
 */
function placedCrops(source, canvas, page, pageNumber) {
  const area = canvas.width * canvas.height;
  const rects = imageRects(canvas, page.imageCoordinates)
    // A dish photo is a modest part of the page; a near-full-page or banner
    // image is a background, so it is dropped and the model is asked instead.
    .filter((rect) => rect.width >= canvas.width * 0.04 && rect.height >= canvas.height * 0.04 && rect.width <= canvas.width * 0.8 && rect.height <= canvas.height * 0.8 && rect.width * rect.height <= area * 0.5)
    // One photo can be recorded as several overlapping pieces: keep the largest.
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .filter((rect, _i, all) => !all.some((other) => other !== rect && other.width * other.height > rect.width * rect.height && overlaps(other, rect)));
  return rects.map((rect, i) =>
    crop(`${pageNumber}:p${i}`, cropPdfPixels(source, canvas, rect, { padding: 2 }), { rect: { x0: rect.x, y0: rect.y, x1: rect.x + rect.width, y1: rect.y + rect.height } }),
  );
}

const overlaps = (a, b) => {
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 0 && y > 0 && x * y > a.width * a.height * 0.9;
};

/** The photos a scanned page's model put boxes around, as crops of its render. */
function boxedCrops(source, canvas, transcription, pageNumber) {
  const crops = [];
  let i = 0;
  for (const section of transcription.sections ?? []) {
    for (const item of section.items ?? []) {
      const box = Array.isArray(item.box) && item.box.length === 4 ? item.box.map(Number) : null;
      if (!box || !box.every((n) => Number.isFinite(n))) continue;
      const [x, y, w, h] = box;
      const png = cropPdfPixels(source, canvas, { x: x * canvas.width, y: y * canvas.height, width: w * canvas.width, height: h * canvas.height }, { padding: 2 });
      crops.push(crop(`${pageNumber}:b${i++}`, png, { name: item.name }));
    }
  }
  return crops;
}

/** The title line the run prints, naming the pages and who read them. */
function menuTitle(chosen, reading, provider, model, currency) {
  const pdfs = chosen.filter((page) => page.kind === "pdf").length;
  const kind = pdfs === chosen.length ? "PDF" : pdfs === 0 ? "Picture" : "Picture and PDF";
  const from = [...new Set(chosen.map((page) => (page.kind === "pdf" ? page.host : new URL(page.url).hostname)))].join(", ");
  return `${kind} menu: ${chosen.length} pages from ${from} (${reading} read with ${providers[provider].label} ${model}, ${chosen.length - reading} from the saved transcriptions), prices in ${currency}`;
}

/** Saves the matched crops and fills `image_url` when a base URL was given. */
async function saveProductImages(matches, { imageDir, imageBaseUrl, projectDir }) {
  const dir = resolveIn(projectDir, imageDir ?? workDirIn(projectDir, "menu-images"));
  await mkdir(dir, { recursive: true });
  const base = imageBaseUrl ? imageBaseUrl.replace(/\/*$/, "/") : null;
  const notes = [];
  let index = 0;
  for (const { placement, crop: image } of matches) {
    // Page-prefixed so re-running a different `--only` range does not overwrite earlier files.
    const file = `p${placement.page}-${String(index + 1).padStart(3, "0")}-${slugify(placement.name) || "foto"}.png`;
    await writeFile(join(dir, file), image.png);
    if (base) for (const product of placement.products) product.image_url = base + file;
    index++;
  }
  notes.push(`Saved ${matches.length} product photo(s) to ${dir}.`);
  if (matches.length) {
    notes.push(
      base
        ? `image_url points at ${base}<file name>; publish that folder there, or the site shows a broken picture.`
        : "image_url was left empty: upload the photos and re-run with `imageBaseUrl` (`--image-base-url`) to fill it.",
    );
  }
  return notes;
}

/** Reads the pages and normalizes them: `{ menu, notes, title }`, ready for importMenu. */
export async function fetchImageMenu({ urls = [], only, provider, model, minWidth = 500, refresh = false, apiKey, env, projectDir, config = defaultConfig, imageDir, imageBaseUrl, imageBoxes = "auto", log: logOption } = {}) {
  const log = normalizeLog(logOption);
  provider = String(provider || resolveEnv(env).MENU_VISION_PROVIDER || defaultProvider).toLowerCase();
  if (!Object.hasOwn(providers, provider)) throw optionError("provider", `Unknown provider "${provider}" (from \`provider\` or MENU_VISION_PROVIDER). Use one of: ${providerNames}.`, "ECONFIG");
  model ||= providers[provider].defaultModel;
  // The base URL the saved photos will be published at; it must be a real https
  // URL, because the database only stores https image links.
  if (imageBaseUrl) {
    let parsed = null;
    try {
      parsed = new URL(imageBaseUrl);
    } catch {
      parsed = null;
    }
    if (parsed?.protocol !== "https:") throw optionError("imageBaseUrl", "`imageBaseUrl` must be an https URL, because the database only stores https image links.", "EUSAGE");
  }
  const extractImages = Boolean(imageDir || imageBaseUrl);
  const scale = Number(config.imageScale) > 0 ? Number(config.imageScale) : 2;
  if (!["auto", "always"].includes(imageBoxes)) throw optionError("imageBoxes", "`imageBoxes` must be \"auto\" or \"always\".", "EUSAGE");
  // `always` reads every PDF page as a picture so the model can box every dish's
  // photo, even when the page also places some photos separately; `auto` only
  // does that when the page has no separately placed photo.
  const alwaysBoxes = imageBoxes === "always";

  const found = await findPages({ urls, only, minWidth, projectDir, config });
  try {
    const transcriptions = new Array(found.chosen.length);
    const pageImages = new Map();
    let next = 0;
    let reading = 0;
    const worker = async () => {
      while (next < found.chosen.length) {
        const slot = next++;
        const page = found.chosen[slot];
        const host = page.kind === "pdf" ? page.host : new URL(page.url).hostname;
        const id = page.kind === "pdf" ? pageId(`${page.label}#${page.pageNumber}`) : pageId(page.url);
        const dir = join(workDirIn(projectDir, "cache"), host);
        await mkdir(dir, { recursive: true });
        const cachedFile = join(dir, `${id}.json`);
        const saved = refresh
          ? null
          : await readFile(cachedFile, "utf8").catch((error) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });

        let transcription = null;
        if (saved !== null) {
          try {
            transcription = JSON.parse(saved);
          } catch (error) {
            throw new TablefactsError(`The saved transcription ${cachedFile} is not valid JSON (fix it, delete it, or pass \`refresh\`).`, "EFAILED", { cause: error });
          }
        }

        const isPdf = page.kind === "pdf";
        const read = isPdf ? await readPdfText(page.source, page.pageNumber) : null;

        // When photos are wanted, render the page first: if it has no separately
        // placed photo, the model must look at the page itself (a flattened or
        // vector design), so the page is read as a picture with boxes rather
        // than from its text.
        let render = null;
        let placed = null;
        if (extractImages && isPdf) {
          const rendered = await renderPdfPage(page.source, read.page, { scale, recordImages: true });
          render = { page: read.page, ...rendered };
          placed = placedCrops(page.source, render.canvas, read.page, page.number);
        }
        const useVision = isPdf && (page.chars < MIN_PAGE_TEXT || (extractImages && (alwaysBoxes || placed.length === 0)));
        // A page read before photos were asked for has no box on its items: read
        // it again so the model can point at each dish's photo. A page whose
        // items all carry a (null) box was already read with boxes.
        if (useVision && extractImages && transcription && !hasBoxField(transcription)) transcription = null;

        if (transcription === null) {
          reading++;
          log(`Reading page ${page.number}...`);
          if (page.kind === "image") {
            const local = await downloadPage(page, host, { projectDir });
            transcription = await readPage(local, { provider, model, apiKey, env });
          } else if (!useVision) {
            let { text } = read;
            if (text.length > MAX_PAGE_TEXT) {
              log(`Page ${page.number} has ${text.length} characters of text; only the first ${MAX_PAGE_TEXT} were read.`, "warn");
              text = text.slice(0, MAX_PAGE_TEXT);
            }
            transcription = await readText({ text }, { provider, model, apiKey, env });
          } else {
            if (!render) render = { page: read.page, ...(await renderPdfPage(page.source, read.page, { scale })) };
            const png = render.canvas.toBuffer("image/png");
            if (png.length > MAX_PAGE_IMAGE) {
              throw new TablefactsError(`Page ${page.number} rendered to ${(png.length / 1048576).toFixed(1)} MB, more than the vision APIs take. Lower \`imageScale\` in the raw config and try again.`, "EFAILED");
            }
            const image = join(dir, `${id}.png`);
            await writeFile(image, png);
            transcription = await readPage({ file: image, mediaType: "image/png" }, { provider, model, apiKey, env, boxes: extractImages });
          }
          await writeFile(cachedFile, JSON.stringify(transcription, null, 2) + "\n");
        }

        if (extractImages && isPdf) {
          pageImages.set(
            page.number,
            useVision
              ? { width: render.canvas.width, items: [], placed: [], direct: boxedCrops(page.source, render.canvas, transcription, page.number) }
              : { width: render.canvas.width, items: canvasItems(positionedItems(read.items), render.viewport), placed, direct: [] },
          );
        }
        if (render) destroyPage(page.source, render);
        transcriptions[slot] = transcription;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, found.chosen.length) }, worker));

    const { menu, notes, currency, placements } = normalizePages(transcriptions.map((t, i) => ({ ...t, number: found.chosen[i].number })), config);
    const hasPdf = found.chosen.some((page) => page.kind === "pdf");
    if (extractImages && hasPdf) {
      const { matches, notes: imageNotes } = matchPlacements(placements, pageImages);
      notes.push(...imageNotes, ...(await saveProductImages(matches, { imageDir, imageBaseUrl, projectDir })));
    } else if (hasPdf) {
      notes.push("To also save the photos printed on a PDF page, pass `imageDir` (CLI: --images <folder>).");
    }
    notes.unshift(`Prices were read from the menu pages: check them against the original before writing. Transcriptions are saved in .tablefacts/cache/ (edit a .json there to fix a page, then run again).`);
    return {
      menu,
      notes,
      title: menuTitle(found.chosen, reading, provider, model, currency),
      // The restaurant's own table set, so a shared database is never touched by accident.
      tablePrefix: config.tablePrefix,
    };
  } finally {
    await found.close();
  }
}

/**
 * Reads the menu from pictures or a PDF and imports it. Takes importMenu's options too.
 * @param {import('../../lib/types.mjs').ImportImageMenuOptions} [options]
 * @returns {Promise<import('../../lib/types.mjs').ImportResult>}
 */
export async function importImageMenu({ urls, only, provider, model, minWidth, refresh, apiKey, env, config = defaultConfig, ...importOptions } = {}) {
  const fetched = await fetchImageMenu({
    urls,
    only,
    provider,
    model,
    minWidth,
    refresh,
    apiKey,
    env,
    config,
    imageDir: importOptions.imageDir,
    imageBaseUrl: importOptions.imageBaseUrl,
    imageBoxes: importOptions.imageBoxes,
    projectDir: importOptions.projectDir,
    log: importOptions.log,
  });
  // An explicit `tablePrefix` (or the CLI's --table-prefix) wins over the config's.
  return importMenu({ ...fetched, ...importOptions, tablePrefix: importOptions.tablePrefix ?? config.tablePrefix, env });
}
