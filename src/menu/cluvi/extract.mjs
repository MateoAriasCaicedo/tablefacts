#!/usr/bin/env node
// Imports a restaurant's menu from Cluvi into the Supabase menu tables.
// See data/menu/README.md. Run from the repository root:
//   extract menu cluvi --dry-run
import { runImport } from "../lib/run.mjs";
import config from "./config.mjs";
import { fetchCluvi, normalizeCluvi } from "./source.mjs";

const usage = `Usage: extract menu cluvi [menu-url] [options]

Reads the menu of a restaurant on Cluvi and replaces it in Supabase.
menu-url   any page of the restaurant's Cluvi menu (default: config.mjs)

Cluvi options:
  --service <name>   which Cluvi menu to read: on_table (default), delivery, take_away
  --lang <code>      language of the Cluvi menu (default: es)`;

await runImport({
  usage,
  options: {
    service: { type: "string", default: "on_table" },
    lang: { type: "string", default: "es" },
  },
  async fetchMenu({ values, positionals }) {
    const fetched = await fetchCluvi({ url: positionals[0] ?? config.url, service: values.service, lang: values.lang });
    const { menu, notes, currency } = normalizeCluvi(fetched, config);
    const { supplier } = fetched;
    return {
      menu,
      notes,
      title: `Cluvi: ${supplier.label} (id ${supplier.id}), ${values.service} menu in ${currency}`,
    };
  },
});
