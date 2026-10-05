// Gathers what the public web says about a restaurant, to fill the template.
// Usage: extract research "Restaurant name" "City, Country" [options]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { workDir } from "../lib/project.mjs";
import { parseArgs } from "node:util";
import { downloadPhotos, searchGoogle } from "./lib/google.mjs";
import { buildProfile } from "./lib/merge.mjs";
import { searchOsm } from "./lib/osm.mjs";
import { renderReport, setupAnswers } from "./lib/report.mjs";
import { readHub, readInstagram, readTripadvisor } from "./lib/social.mjs";
import { fetchText, loadEnv, slugify } from "./lib/util.mjs";
import { scrapeSite } from "./lib/website.mjs";

const HELP = `Research a restaurant from public sources and write a profile for the template.

  extract research "<name>" "<city, country>" [options]

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
  --out <dir>           output folder (default .extract/research/<slug>)
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
const slug = slugify(name);
const outDir = values.out ?? workDir("research", slug);
const query = { name, location, slug, country: values.country, website: values.website, instagram: values.instagram, tripadvisor: values.tripadvisor, linktree: values.linktree };
const notes = [];
const log = (m) => console.log(m);

/** Runs one source; a failure is a note in the report, never the end of the run. */
async function source(label, fn) {
  try {
    const r = await fn();
    return r ?? null;
  } catch (e) {
    notes.push(`${label}: failed (${e.message})`);
    log(`  ${label}: failed (${e.message})`);
    return null;
  }
}

const key = values["no-google"] ? "" : process.env.GOOGLE_PLACES_API_KEY;
log(`Researching "${name}"${location ? ` in ${location}` : ""}`);

let googleResult = null;
if (key) {
  googleResult = await source("Google Places", () => searchGoogle({ name, location, country: values.country, key }));
  if (googleResult) notes.push(googleResult.place ? `Google Places: matched "${googleResult.place.name}", ${googleResult.place.formattedAddress}` : `Google Places: no result named like "${name}". Closest: ${googleResult.candidates.map((c) => `${c.name} (${c.address})`).join("; ") || "none"}`);
} else notes.push("Google Places: skipped (no GOOGLE_PLACES_API_KEY in .env). Address, hours and phone come from OpenStreetMap and the website instead.");
const google = googleResult?.place ?? null;

const osmResult = await source("OpenStreetMap", () => searchOsm({ name, location, country: values.country }));
if (osmResult) notes.push(osmResult.place ? `OpenStreetMap: matched "${osmResult.place.name}"` : `OpenStreetMap: no match. Closest: ${osmResult.candidates.map((c) => c.name || c.address).join("; ") || "none"}`);
const osm = osmResult?.place ?? null;

const websiteUrl = values.website ?? google?.website ?? osm?.website;
const site = websiteUrl ? await source("Website", () => scrapeSite(websiteUrl, { renderJs: values.render })) : null;
if (site) notes.push(`Website: read ${site.pages.length} page(s) of ${site.url}${site.pages.some((p) => p.rendered) ? " (rendered with Playwright)" : ""}`);
else if (!websiteUrl) notes.push("Website: none found. Pass --website if the restaurant has one.");

// Follow the leads the first sources gave.
const handle = (values.instagram ?? site?.links.instagram[0] ?? osm?.instagram ?? "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
const instagram = handle ? await source("Instagram", () => readInstagram(handle)) : null;
if (instagram) notes.push(instagram.blocked ? `Instagram @${handle}: not readable (${instagram.blocked}). Add the bio by hand, or use \`extract photos instagram\` for posts.` : `Instagram @${handle}: profile card read`);
else if (!handle) notes.push("Instagram: no handle found. Pass --instagram.");

const hubUrl = values.linktree ?? site?.links.hubs[0] ?? instagram?.links?.find((l) => /linktr|beacons|bio\.link|lnk\.bio|taplink/.test(l));
const hub = hubUrl ? await source("Link-in-bio", () => readHub(hubUrl)) : null;
if (hub) notes.push(hub.blocked ? `Link-in-bio ${hubUrl}: not readable (${hub.blocked})` : `Link-in-bio: read ${hub.url}`);

// Links found on the hub can add the pages the website did not link to.
const taUrl = values.tripadvisor ?? site?.links.tripadvisor[0] ?? hub?.links?.tripadvisor?.[0] ?? (site?.jsonld?.sameAs ?? []).find((u) => /tripadvisor\./.test(u));
const tripadvisor = taUrl ? await source("TripAdvisor", () => readTripadvisor(taUrl)) : null;
if (tripadvisor) notes.push(tripadvisor.blocked ? `TripAdvisor ${taUrl}: blocked (${tripadvisor.blocked}). The link is kept; read it by hand.` : "TripAdvisor: page read");
else notes.push("TripAdvisor: no link found. Pass --tripadvisor.");

const profile = buildProfile({ query, google, osm, site, hub: hub?.blocked ? null : hub, instagram, tripadvisor: tripadvisor?.blocked ? null : tripadvisor });
if (tripadvisor?.blocked && taUrl && !profile.fields.tripadvisor) profile.fields.tripadvisor = { value: taUrl, source: "website", confidence: "medium" };

// Optional photo downloads: reference material, never wired into the site.
const photos = [];
const wanted = Number(values.photos ?? 0);
if (wanted > 0) {
  await mkdir(join(outDir, "photos"), { recursive: true });
  const save = (file, buf) => writeFile(join(outDir, "photos", file), buf);
  if (google && key) photos.push(...(await source("Google photos", () => downloadPhotos(google, key, wanted, save)) ?? []));
  for (const [i, img] of (site?.images ?? []).filter((x) => /\.(jpe?g|png|webp)(\?|$)/i.test(x.url)).slice(0, wanted).entries()) {
    try {
      const res = await fetch(img.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 15000) continue;
      const file = `site-${String(i + 1).padStart(2, "0")}${img.url.match(/\.(jpe?g|png|webp)/i)?.[0].toLowerCase() ?? ".jpg"}`;
      await save(file, buf);
      photos.push({ file, source: img.url, alt: img.alt });
    } catch { /* one bad image should not stop the rest */ }
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "profile.json"), JSON.stringify({ ...profile, raw: { google, osm, site, hub, instagram, tripadvisor }, photos }, null, 2));
await writeFile(join(outDir, "report.md"), renderReport(profile, { notes, photos }));
await writeFile(join(outDir, "setup-answers.txt"), setupAnswers(profile));

const found = Object.keys(profile.fields).filter((k) => profile.fields[k]);
log(`\nFound ${found.length} fields: ${found.join(", ")}`);
for (const w of profile.warnings) log(`Warning: ${w}`);
log(`\nWrote ${outDir}\n  report.md          read this first\n  profile.json       everything, with sources\n  setup-answers.txt  npm run setup < that file`);
