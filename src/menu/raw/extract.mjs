#!/usr/bin/env node
// Imports a restaurant's menu from pictures of its pages into the Supabase
// menu tables. See data/menu/README.md. Run from the repository root:
//   extract menu raw --list
//   extract menu raw --dry-run
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runImport } from "../lib/run.mjs";
import config from "./config.mjs";
import { normalizePages } from "./normalize.mjs";
import { discoverPages, downloadPage } from "./source.mjs";
import { defaultProvider, providers, readPage } from "./vision.mjs";

const providerNames = Object.keys(providers).join(", ");
const providerTable = Object.entries(providers)
  .map(([name, { keyName, defaultModel }]) => `  ${name.padEnd(10)} ${keyName.padEnd(18)} ${defaultModel}`)
  .join("\n");

const usage = `Usage: extract menu raw [page-or-image-url...] [options]

Reads a menu that is only pictures (one image per page) by transcribing each
page with a vision model, and replaces the menu in Supabase.
The URLs are pages to scan for menu images, or direct image URLs
(default: config.mjs). The key of the provider that reads the pages goes in
.env:

  provider   key                default model
${providerTable}

Image menu options:
  --list              show the pictures found and stop; nothing is read or written
  --only <pages>      only these pages, numbered as --list shows them (e.g. 1,3-5)
  --provider <name>   who reads the pages: ${providerNames}
                      (default: MENU_VISION_PROVIDER in .env, else ${defaultProvider})
  --model <id>        model of that provider (default: see the table)
  --min-width <px>    ignore images declaring a smaller width (default: 500)
  --refresh           read the pages again instead of using the saved transcriptions`;

/** "1,3-5" to Set {1,3,4,5}. */
function pageSet(text) {
  const wanted = new Set();
  for (const part of text.split(",")) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`--only "${text}" is not a list of pages such as 1,3-5.`);
    for (let n = Number(m[1]); n <= Number(m[2] ?? m[1]); n++) wanted.add(n);
  }
  return wanted;
}

async function findPages(urls, values) {
  const pages = await discoverPages(urls.length ? urls : [config.url], { minWidth: Number(values["min-width"]) });
  const wanted = values.only ? pageSet(values.only) : null;
  const chosen = pages.map((page, i) => ({ ...page, number: i + 1 })).filter((page) => !wanted || wanted.has(page.number));
  if (!chosen.length) throw new Error(`--only ${values.only} matches none of the ${pages.length} pages found.`);
  return { pages, chosen };
}

const shared = {
  "min-width": { type: "string", default: "500" },
  only: { type: "string" },
};

if (process.argv.includes("--list")) {
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { ...shared, list: { type: "boolean" }, help: { type: "boolean", short: "h" } }, strict: false });
    const { pages, chosen } = await findPages(positionals, values);
    console.log(`${pages.length} images found:\n`);
    for (const page of chosen) console.log(`  ${String(page.number).padStart(2)}  ${page.url}${page.alt ? `\n      ${page.alt.slice(0, 100)}` : ""}`);
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
} else {
  await runImport({
    usage,
    options: {
      ...shared,
      provider: { type: "string" },
      model: { type: "string" },
      refresh: { type: "boolean" },
    },
    async fetchMenu({ values, positionals }) {
      // .env is loaded by now, so MENU_VISION_PROVIDER can come from there.
      const provider = (values.provider || process.env.MENU_VISION_PROVIDER || defaultProvider).toLowerCase();
      if (!Object.hasOwn(providers, provider)) throw new Error(`Unknown provider "${provider}" (from --provider or MENU_VISION_PROVIDER). Use one of: ${providerNames}.`);
      const model = values.model || providers[provider].defaultModel;

      const { chosen } = await findPages(positionals, values);
      const host = new URL(positionals[0] ?? config.url).hostname;

      const transcriptions = new Array(chosen.length);
      let next = 0;
      let reading = 0;
      const worker = async () => {
        while (next < chosen.length) {
          const slot = next++;
          const page = chosen[slot];
          const local = await downloadPage(page, host);
          const cached = join(local.dir, `${local.id}.json`);
          if (!values.refresh && existsSync(cached)) {
            transcriptions[slot] = JSON.parse(readFileSync(cached, "utf8"));
            continue;
          }
          reading++;
          console.log(`Reading page ${page.number}...`);
          transcriptions[slot] = await readPage(local, { provider, model });
          writeFileSync(cached, JSON.stringify(transcriptions[slot], null, 2) + "\n");
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, chosen.length) }, worker));

      const { menu, notes, currency } = normalizePages(transcriptions.map((t, i) => ({ ...t, number: chosen[i].number })), config);
      notes.unshift(`Prices were read from pictures: check them against the menu before writing. Transcriptions are saved in .extract/cache/${host}/ (edit a .json there to fix a page, then run again).`);
      return {
        menu,
        notes,
        title: `Image menu: ${chosen.length} pages from ${host} (${reading} read with ${providers[provider].label} ${model}, ${chosen.length - reading} from the saved transcriptions), prices in ${currency}`,
      };
    },
  });
}
