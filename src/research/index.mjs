// Programmatic entry for the research pipeline: gathers what the public web says
// about a restaurant and writes profile.json, report.md and setup-answers.txt.
// Silent by default and never exits the process; the CLI lives in research.mjs.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveEnv } from "../lib/env.mjs";
import { optionError } from "../lib/errors.mjs";
import { normalizeLog } from "../lib/log.mjs";
import { resolveIn, workDirIn } from "../lib/project.mjs";
import { downloadPhotos, searchGoogle } from "./lib/google.mjs";
import { buildProfile } from "./lib/merge.mjs";
import { searchOsm } from "./lib/osm.mjs";
import { renderReport, setupAnswers } from "./lib/report.mjs";
import { readHub, readInstagram, readTripadvisor } from "./lib/social.mjs";
import { mapPool, slugify } from "./lib/util.mjs";
import { createBrowser, scrapeSite } from "./lib/website.mjs";

/**
 * Researches a restaurant from public sources and writes profile.json, report.md and
 * setup-answers.txt. Silent unless `log` is given; a source that fails becomes a note in the
 * report, not an error. Throws a TablefactsError with code 'EUSAGE' (and `option` 'name') when
 * `name` is missing.
 * @param {import('../lib/types.mjs').ResearchOptions} options
 * @returns {Promise<import('../lib/types.mjs').ResearchResult>}
 */
export async function research(options = {}) {
  const { name, location = "", country, website, instagram: instagramOpt, tripadvisor: tripadvisorOpt, linktree, photos: photosOpt = 0, render = false, google: useGoogle = true } = options;
  if (typeof name !== "string" || !name.trim()) throw optionError("name", "research: `name` is required");
  const log = normalizeLog(options.log);
  const env = resolveEnv(options.env);

  const slug = slugify(name);
  const outDir = options.out ? resolveIn(options.projectDir, options.out) : workDirIn(options.projectDir, "research", slug);
  const query = { name, location, slug, country, website, instagram: instagramOpt, tripadvisor: tripadvisorOpt, linktree };
  const notes = [];

  /** Runs one source; a failure is a note in the report, never the end of the run. */
  async function source(label, fn, sink = notes) {
    try {
      return (await fn()) ?? null;
    } catch (e) {
      sink.push(`${label}: failed (${e.message})`);
      log(`  ${label}: failed (${e.message})`, "warn");
      return null;
    }
  }

  const key = useGoogle === false ? "" : (options.googleKey ?? env.GOOGLE_PLACES_API_KEY);
  log(`Researching "${name}"${location ? ` in ${location}` : ""}`, "info");

  // One Chromium for the whole run, launched only if a page needs rendering.
  const browser = createBrowser();
  let site, instagram, hub, tripadvisor, taUrl, handle, google, osm;
  try {
    // Google and OpenStreetMap only need the name and place, so they run together; their notes are added in this order afterwards.
    const googleNotes = [];
    const osmNotes = [];
    if (!key) notes.push("Google Places: skipped (no GOOGLE_PLACES_API_KEY in .env, and no `googleKey`). Address, hours and phone come from OpenStreetMap and the website instead.");
    const [googleResult, osmResult] = await Promise.all([
      key ? source("Google Places", () => searchGoogle({ name, location, country, key }), googleNotes) : null,
      source("OpenStreetMap", () => searchOsm({ name, location, country }), osmNotes),
    ]);
    if (googleResult) googleNotes.push(googleResult.place ? `Google Places: matched "${googleResult.place.name}", ${googleResult.place.formattedAddress}` : `Google Places: no result named like "${name}". Closest: ${googleResult.candidates.map((c) => `${c.name} (${c.address})`).join("; ") || "none"}`);
    if (osmResult) osmNotes.push(osmResult.place ? `OpenStreetMap: matched "${osmResult.place.name}"` : `OpenStreetMap: no match. Closest: ${osmResult.candidates.map((c) => c.name || c.address).join("; ") || "none"}`);
    notes.push(...googleNotes, ...osmNotes);
    google = googleResult?.place ?? null;
    osm = osmResult?.place ?? null;

    const websiteUrl = website ?? google?.website ?? osm?.website;
    site = websiteUrl ? await source("Website", () => scrapeSite(websiteUrl, { renderJs: render, browser })) : null;
    if (site) notes.push(`Website: read ${site.pages.length} page(s) of ${site.url}${site.pages.some((p) => p.rendered) ? " (rendered with Playwright)" : ""}`);
    else if (!websiteUrl) notes.push("Website: none found. Pass the website (--website / `website`) if the restaurant has one.");

    // Follow the leads the first sources gave. What is already known (handle, TripAdvisor link, hub link)
    // starts right away; the rest waits only for the source that can supply it.
    handle = (instagramOpt ?? site?.links.instagram[0] ?? osm?.instagram ?? "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
    taUrl = tripadvisorOpt ?? site?.links.tripadvisor[0] ?? (site?.jsonld?.sameAs ?? []).find((u) => /tripadvisor\./.test(u));
    const directHubUrl = linktree ?? site?.links.hubs[0];
    const readHubAt = (url) => source("Link-in-bio", () => readHub(url, { browser }));

    const instagramP = handle ? source("Instagram", () => readInstagram(handle)) : null;
    const tripadvisorP = taUrl ? source("TripAdvisor", () => readTripadvisor(taUrl, { browser })) : null;
    // The hub URL comes from the options or the website, else from the Instagram bio.
    const hubTask = (async () => {
      let url = directHubUrl;
      if (!url) {
        const ig = await instagramP;
        url = ig?.links?.find((l) => /linktr|beacons|bio\.link|lnk\.bio|taplink/.test(l));
      }
      return url ? { url, result: await readHubAt(url) } : { url: null, result: null };
    })();

    instagram = instagramP ? await instagramP : null;
    const hubRead = await hubTask;
    hub = hubRead.result;
    const hubUrl = hubRead.url;
    if (!taUrl) {
      // Links found on the hub can add the pages the website did not link to.
      taUrl = hub?.links?.tripadvisor?.[0];
      if (taUrl) tripadvisor = await source("TripAdvisor", () => readTripadvisor(taUrl, { browser }));
    } else {
      tripadvisor = await tripadvisorP;
    }

    // Notes keep the order of the sequential flow: Instagram, link-in-bio, TripAdvisor.
    if (instagram) notes.push(instagram.blocked ? `Instagram @${handle}: not readable (${instagram.blocked}). Add the bio by hand, or use \`tablefacts photos instagram\` for posts.` : `Instagram @${handle}: profile card read`);
    else if (!handle) notes.push("Instagram: no handle found. Pass the handle (--instagram / `instagram`).");
    if (hub) notes.push(hub.blocked ? `Link-in-bio ${hubUrl}: not readable (${hub.blocked})` : `Link-in-bio: read ${hub.url}`);
    if (tripadvisor) notes.push(tripadvisor.blocked ? `TripAdvisor ${taUrl}: blocked (${tripadvisor.blocked}). The link is kept; read it by hand.` : "TripAdvisor: page read");
    else notes.push("TripAdvisor: no link found. Pass the page (--tripadvisor / `tripadvisor`).");
  } finally {
    await browser.close();
  }

  const profile = buildProfile({ query, google, osm, site, hub: hub?.blocked ? null : hub, instagram, tripadvisor: tripadvisor?.blocked ? null : tripadvisor });
  if (tripadvisor?.blocked && taUrl && !profile.fields.tripadvisor) profile.fields.tripadvisor = { value: taUrl, source: "website", confidence: "medium" };

  // Optional photo downloads: reference material, never wired into the site.
  const photos = [];
  const wanted = Number(photosOpt ?? 0);
  if (wanted > 0) {
    await mkdir(join(outDir, "photos"), { recursive: true });
    const save = (file, buf) => writeFile(join(outDir, "photos", file), buf);
    if (google && key) photos.push(...(await source("Google photos", () => downloadPhotos(google, key, wanted, save)) ?? []));
    const images = (site?.images ?? []).filter((x) => /\.(jpe?g|png|webp)(\?|$)/i.test(x.url)).slice(0, wanted);
    const saved = await mapPool(images, 4, async (img, i) => {
      try {
        const res = await fetch(img.url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 15000) return null;
        const file = `site-${String(i + 1).padStart(2, "0")}${img.url.match(/\.(jpe?g|png|webp)/i)?.[0].toLowerCase() ?? ".jpg"}`;
        await save(file, buf);
        return { file, source: img.url, alt: img.alt };
      } catch { return null; /* one bad image should not stop the rest */ }
    });
    photos.push(...saved.filter(Boolean));
  }

  const files = { profile: resolve(outDir, "profile.json"), report: resolve(outDir, "report.md"), setupAnswers: resolve(outDir, "setup-answers.txt") };
  await mkdir(outDir, { recursive: true });
  await writeFile(files.profile, JSON.stringify({ ...profile, raw: { google, osm, site, hub, instagram, tripadvisor }, photos }, null, 2));
  await writeFile(files.report, renderReport(profile, { notes, photos }));
  await writeFile(files.setupAnswers, setupAnswers(profile));

  return { profile, notes, photos, outDir, files };
}
