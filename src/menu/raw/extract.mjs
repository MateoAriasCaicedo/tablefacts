#!/usr/bin/env node
// Imports a restaurant's menu from pictures of its pages into the Supabase
// menu tables. See src/menu/README.md. Run from the project's folder:
//   tablefacts menu raw --list
//   tablefacts menu raw --dry-run
import { parseArgs } from "node:util";
import { cliLog, menuFlags, runImport } from "../lib/run.mjs";
import { cliMessage, exitCodeFor } from "../../lib/errors.mjs";
import { fetchImageMenu, findPages } from "./import.mjs";
import { defaultProvider, providers } from "./vision.mjs";

const providerNames = Object.keys(providers).join(", ");
const providerTable = Object.entries(providers)
  .map(([name, { keyName, defaultModel }]) => `  ${name.padEnd(10)} ${keyName.padEnd(18)} ${defaultModel}`)
  .join("\n");

const usage = `Usage: tablefacts menu raw [page-or-image-url...] [options]

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

const shared = {
  "min-width": { type: "string", default: "500" },
  only: { type: "string" },
};

if (process.argv.includes("--list")) {
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { ...shared, list: { type: "boolean" }, help: { type: "boolean", short: "h" } }, strict: false });
    const { pages, chosen } = await findPages({ urls: positionals, only: values.only, minWidth: values["min-width"] });
    console.log(`${pages.length} images found:\n`);
    for (const page of chosen) console.log(`  ${String(page.number).padStart(2)}  ${page.url}${page.alt ? `\n      ${page.alt.slice(0, 100)}` : ""}`);
  } catch (error) {
    console.error(`\n${cliMessage(error, menuFlags)}`);
    process.exitCode = exitCodeFor(error);
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
    fetchMenu: ({ values, positionals }) =>
      fetchImageMenu({
        urls: positionals,
        only: values.only,
        provider: values.provider, // else MENU_VISION_PROVIDER, which loadEnv has read by now
        model: values.model,
        minWidth: values["min-width"],
        refresh: values.refresh,
        log: cliLog,
      }),
  });
}
