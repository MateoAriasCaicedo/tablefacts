#!/usr/bin/env node
// Imports a restaurant's menu from pictures of its pages, or from a PDF, into
// the Supabase menu tables. See src/menu/README.md. Run from the project's folder:
//   tablefacts menu raw --list
//   tablefacts menu raw --dry-run
//   tablefacts menu raw carta.pdf --images ./photos --image-base-url https://cdn.example.com/menu/ --dry-run
import { parseArgs } from "node:util";
import { cliLog, menuFlags, runImport } from "../lib/run.mjs";
import { cliMessage, exitCodeFor } from "../../lib/errors.mjs";
import { fetchImageMenu, findPages } from "./import.mjs";
import { defaultProvider, providers } from "./vision.mjs";

const providerNames = Object.keys(providers).join(", ");
const providerTable = Object.entries(providers)
  .map(([name, { keyName, defaultModel }]) => `  ${name.padEnd(10)} ${keyName.padEnd(18)} ${defaultModel}`)
  .join("\n");

const usage = `Usage: tablefacts menu raw [page-or-image-url...] [pdf-file-or-url...] [options]

Reads a menu that is only pictures (one image per page) or a PDF, and replaces
the menu in Supabase. A PDF page is transcribed from its text when it has one,
and from a render of the page when it is a scan. The URLs are pages to scan for
menu images, or direct image URLs; an argument ending in .pdf is a PDF file
(local path) or URL. Default: config.mjs. The key of the provider that reads the
pages goes in .env:

  provider   key                default model
${providerTable}

Picture and PDF options:
  --list              show the pages found and stop; nothing is read or written
  --only <pages>      only these pages, numbered as --list shows them (e.g. 1,3-5)
  --provider <name>   who reads the pages: ${providerNames}
                      (default: MENU_VISION_PROVIDER in .env, else ${defaultProvider})
  --model <id>        model of that provider (default: see the table)
  --min-width <px>    ignore images declaring a smaller width (default: 500)
  --refresh           read the pages again instead of using the saved transcriptions
  --images <folder>   also save the dish photos printed on a PDF page
  --image-base-url <url>  https folder you will publish them at; fills image_url
  --image-boxes <auto|always>  auto (default) reads the page as text and matches
                      photos by position; always reads every page as a picture so
                      the model boxes every dish's photo (a vision call per page)
`;

const shared = {
  "min-width": { type: "string", default: "500" },
  only: { type: "string" },
};

if (process.argv.includes("--list")) {
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { ...shared, list: { type: "boolean" }, help: { type: "boolean", short: "h" }, images: { type: "string" }, "image-base-url": { type: "string" }, "image-boxes": { type: "string" } }, strict: false });
    const { pages, chosen, close } = await findPages({ urls: positionals, only: values.only, minWidth: values["min-width"] });
    try {
      console.log(`${pages.length} pages found:\n`);
      for (const page of chosen) {
        const detail = page.kind === "pdf" ? (page.chars >= 40 ? `${page.chars} characters of text` : "scanned; read as a picture") : page.alt?.slice(0, 100) ?? "";
        console.log(`  ${String(page.number).padStart(2)}  ${page.url}${detail ? `\n      ${detail}` : ""}`);
      }
    } finally {
      await close();
    }
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
      images: { type: "string" },
      "image-base-url": { type: "string" },
      "image-boxes": { type: "string" },
    },
    fetchMenu: ({ values, positionals }) =>
      fetchImageMenu({
        urls: positionals,
        only: values.only,
        provider: values.provider, // else MENU_VISION_PROVIDER, which loadEnv has read by now
        model: values.model,
        minWidth: values["min-width"],
        refresh: values.refresh,
        imageDir: values.images,
        imageBaseUrl: values["image-base-url"],
        imageBoxes: values["image-boxes"],
        log: cliLog,
      }),
  });
}
