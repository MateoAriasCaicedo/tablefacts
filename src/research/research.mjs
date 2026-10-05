// Gathers what the public web says about a restaurant, to fill the template.
// Usage: tablefacts research "Restaurant name" "City, Country" [options]
import { parseArgs } from "node:util";
import { research } from "./index.mjs";
import { loadEnv } from "../lib/env.mjs";
import { cliMessage, exitCodeFor } from "../lib/errors.mjs";
import { consoleLog } from "../lib/log.mjs";

const HELP = `Research a restaurant from public sources and write a profile for the template.

  tablefacts research "<name>" "<city, country>" [options]

Sources: Google Maps (Places API), OpenStreetMap, the restaurant's website,
Instagram, TripAdvisor and link-in-bio pages (Linktree and similar). They find
each other: the website or Google leads to Instagram, TripAdvisor and the hub.

Options:
  --country <ISO>       country code, narrows the search (CO, MX, US...)
  --website <url>       the restaurant's site, if the search does not find it
  --instagram <handle>  Instagram handle or URL
  --tripadvisor <url>   TripAdvisor page
  --linktree <url>      Linktree or other link-in-bio page
  --photos <n>          also download up to n Google and n website photos (reference only)
  --render              render the website with Playwright (sites built in JavaScript)
  --no-google           skip Google even if GOOGLE_PLACES_API_KEY is set
  --out <dir>           output folder (default .tablefacts/research/<slug>)
  -h, --help            this text

Writes profile.json, report.md and setup-answers.txt. GOOGLE_PLACES_API_KEY goes
in .env (see .env.example); without it OpenStreetMap and the web pages
still work, with fewer facts.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    country: { type: "string" }, website: { type: "string" }, instagram: { type: "string" },
    tripadvisor: { type: "string" }, linktree: { type: "string" }, photos: { type: "string" },
    render: { type: "boolean" }, "no-google": { type: "boolean" }, out: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help || !positionals.length) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

loadEnv();
const [name, location = ""] = positionals;
try {
  const { profile, outDir } = await research({
    name, location, country: values.country, website: values.website, instagram: values.instagram,
    tripadvisor: values.tripadvisor, linktree: values.linktree, render: values.render,
    google: !values["no-google"], photos: Number(values.photos ?? 0), out: values.out, log: consoleLog,
  });
  const found = Object.keys(profile.fields).filter((k) => profile.fields[k]);
  console.log(`
Found ${found.length} fields: ${found.join(", ")}`);
  for (const w of profile.warnings) console.log(`Warning: ${w}`);
  console.log(`
Wrote ${outDir}
  report.md          read this first
  profile.json       everything, with sources
  setup-answers.txt  npm run setup < that file`);
} catch (e) {
  console.error(cliMessage(e, { name: "<name>" }));
  process.exitCode = exitCodeFor(e);
}
