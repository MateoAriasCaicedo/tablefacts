#!/usr/bin/env node
// Imports a restaurant's menu from Cluvi into the Supabase menu tables.
// See src/menu/README.md. Run from the project's folder:
//   tablefacts menu cluvi --dry-run
import { runImport } from "../lib/run.mjs";
import { fetchCluviMenu } from "./import.mjs";

const usage = `Usage: tablefacts menu cluvi [menu-url] [options]

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
  fetchMenu: ({ values, positionals }) => fetchCluviMenu({ url: positionals[0], service: values.service, lang: values.lang }),
});
