// Menus that are only pictures, as a library: find the pages, have a vision
// model transcribe them (saved in the cache), normalize and import.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveEnv } from "../../lib/env.mjs";
import { optionError, TablefactsError } from "../../lib/errors.mjs";
import { normalizeLog } from "../../lib/log.mjs";
import { importMenu } from "../lib/import.mjs";
import defaultConfig from "./config.mjs";
import { normalizePages } from "./normalize.mjs";
import { discoverPages, downloadPage } from "./source.mjs";
import { defaultProvider, providers, readPage } from "./vision.mjs";

const providerNames = Object.keys(providers).join(", ");

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

/** Every image found, and the numbered ones `only` selects. `config` defaults to config.mjs. */
export async function findPages({ urls = [], only, minWidth = 500, config = defaultConfig } = {}) {
  if (!urls.length && !config.url) throw new TablefactsError("No menu page to read: pass urls, or set url in the raw menu config.", "ECONFIG");
  const pages = await discoverPages(urls.length ? urls : [config.url], { minWidth: Number(minWidth) });
  const wanted = only === undefined || only === "" ? null : pageSet(only);
  const chosen = pages.map((page, i) => ({ ...page, number: i + 1 })).filter((page) => !wanted || wanted.has(page.number));
  if (!chosen.length) throw optionError("only", `\`only\` ${only} matches none of the ${pages.length} pages found.`);
  return { pages, chosen };
}

/**
 * The pictures the CLI's `--list` prints, numbered. `only` narrows them.
 * @param {import('../../lib/types.mjs').ListMenuImagesOptions} [options]
 * @returns {Promise<import('../../lib/types.mjs').MenuImage[]>}
 */
export async function listMenuImages(options = {}) {
  return (await findPages(options)).chosen;
}

/** Reads the pages and normalizes them: `{ menu, notes, title }`, ready for importMenu. */
export async function fetchImageMenu({ urls = [], only, provider, model, minWidth = 500, refresh = false, apiKey, env, projectDir, config = defaultConfig, log: logOption } = {}) {
  const log = normalizeLog(logOption);
  provider = String(provider || resolveEnv(env).MENU_VISION_PROVIDER || defaultProvider).toLowerCase();
  if (!Object.hasOwn(providers, provider)) throw optionError("provider", `Unknown provider "${provider}" (from \`provider\` or MENU_VISION_PROVIDER). Use one of: ${providerNames}.`, "ECONFIG");
  model ||= providers[provider].defaultModel;

  const { chosen } = await findPages({ urls, only, minWidth, config });
  const host = new URL(urls[0] ?? config.url).hostname;

  const transcriptions = new Array(chosen.length);
  let next = 0;
  let reading = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const slot = next++;
      const page = chosen[slot];
      const local = await downloadPage(page, host, { projectDir });
      const cached = join(local.dir, `${local.id}.json`);
      const saved = refresh ? null : await readFile(cached, "utf8").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (saved !== null) {
        transcriptions[slot] = JSON.parse(saved);
        continue;
      }
      reading++;
      log(`Reading page ${page.number}...`);
      transcriptions[slot] = await readPage(local, { provider, model, apiKey, env });
      await writeFile(cached, JSON.stringify(transcriptions[slot], null, 2) + "\n");
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, worker));

  const { menu, notes, currency } = normalizePages(transcriptions.map((t, i) => ({ ...t, number: chosen[i].number })), config);
  notes.unshift(`Prices were read from pictures: check them against the menu before writing. Transcriptions are saved in .tablefacts/cache/${host}/ (edit a .json there to fix a page, then run again).`);
  return {
    menu,
    notes,
    title: `Image menu: ${chosen.length} pages from ${host} (${reading} read with ${providers[provider].label} ${model}, ${chosen.length - reading} from the saved transcriptions), prices in ${currency}`,
  };
}

/**
 * Reads the menu from pictures with a vision model and imports it. Takes importMenu's options too.
 * @param {import('../../lib/types.mjs').ImportImageMenuOptions} [options]
 * @returns {Promise<import('../../lib/types.mjs').ImportResult>}
 */
export async function importImageMenu({ urls, only, provider, model, minWidth, refresh, apiKey, env, config, ...importOptions } = {}) {
  const fetched = await fetchImageMenu({ urls, only, provider, model, minWidth, refresh, apiKey, env, config, projectDir: importOptions.projectDir, log: importOptions.log });
  return importMenu({ ...fetched, ...importOptions, env });
}
