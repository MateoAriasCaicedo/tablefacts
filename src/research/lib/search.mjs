// Key-free web search, used when Google Places and OpenStreetMap find no place
// (or no website): a bare name + place otherwise yields an empty report. It only
// surfaces candidate links (website, Instagram, TripAdvisor, Maps, hub); the rest
// of the pipeline follows them. DuckDuckGo's Lite endpoint is tried first (the
// same results in simpler HTML, no JavaScript), then the html endpoint. No key
// and no login. A bot wall makes the source fail like any other.
import { fetchText, fold, sameText, tokens, decodeHtml, instagramHandle } from "./util.mjs";

const DDG = [
  "https://lite.duckduckgo.com/lite/",
  "https://html.duckduckgo.com/html/",
];

// Hosts that are directories or social pages, never the restaurant's own site.
const NOT_WEBSITE =
  /(duckduckgo|bing|google|youtube|facebook|instagram|tiktok|twitter|(^|\.)x\.com$|tripadvisor|yelp|wikipedia|foursquare|mapquest|waze|trip\.com|expedia|booking|airbnb|justdial|zomato|rappi|ubereats|pedidosya|doordash|grubhub|glovo|opentable|thefork|eltenedor|exploretock|sevenrooms|covermanager|quandoo|linktr|beacons|linkin\.bio|lnk\.bio|taplink|wa\.me|whatsapp)/i;
const INSTAGRAM = /(^|\.)instagram\.com$/i;
const TRIPADVISOR = /tripadvisor\./i;
const FACEBOOK = /(^|\.)facebook\.com$|(^|\.)fb\.com$/i;
const TIKTOK = /(^|\.)tiktok\.com$/i;
const MAPS = /maps\.app\.goo\.gl|(^|\.)google\.[a-z.]+\/maps|maps\.google\.com|goo\.gl\/maps/i;
const HUBS = /(linktr\.ee|beacons\.ai|bio\.link|lnk\.bio|linktree\.com|taplink|campsite\.bio|solo\.to|linkin\.bio|flow\.page)/i;

const textOf = (s) => decodeHtml(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Unwraps DuckDuckGo's `//duckduckgo.com/l/?uddg=<url>` redirect to the real result URL. */
export function resultUrl(href) {
  if (!href) return null;
  let u;
  try { u = new URL(href, "https://html.duckduckgo.com"); } catch { return null; }
  if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) {
    const target = u.searchParams.get("uddg");
    if (!target) return null;
    try { return new URL(target).href; } catch { return null; }
  }
  return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
}

// One pass over the page, matching a result link or a snippet cell in order, so a
// result with no snippet cannot borrow the next result's text.
const RESULT_TOKEN = /<a\b([^>]*\b(?:result__a|result-link)\b[^>]*)>([\s\S]*?)<\/a>|<([a-z]+)\b[^>]*\b(?:result__snippet|result-snippet)\b[^>]*>([\s\S]*?)<\/\3>/gi;

/** Pulls { url, title, snippet } out of DuckDuckGo's HTML result page (no DOM parser). */
export function parseSearchResults(html) {
  const out = [];
  const seen = new Set();
  let current = -1;
  for (const m of html.matchAll(RESULT_TOKEN)) {
    if (m[1] !== undefined) {
      const href = m[1].match(/href=["']([^"']+)["']/i)?.[1] ?? "";
      const url = resultUrl(href);
      if (!url || seen.has(url)) { current = -1; continue; }
      seen.add(url);
      out.push({ url, title: textOf(m[2]), snippet: "" });
      current = out.length - 1;
    } else if (current >= 0 && !out[current].snippet) {
      out[current].snippet = textOf(m[4]);
    }
  }
  return out;
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

/**
 * Sorts results into the links the pipeline can follow. `website` is the best
 * non-directory result whose title/host looks like the restaurant's name; a
 * result that only matches the place is kept as a weaker candidate.
 */
export function classifyResults(results, { name = "" } = {}) {
  const links = { website: [], instagram: [], tripadvisor: [], facebook: [], tiktok: [], maps: [], hubs: [] };
  const add = (k, v) => { if (v && !links[k].includes(v)) links[k].push(v); };
  const candidates = [];
  for (const { url, title, snippet } of results) {
    const host = hostOf(url);
    if (INSTAGRAM.test(host)) {
      const handle = instagramHandle(url);
      if (handle) add("instagram", handle);
    } else if (TRIPADVISOR.test(host)) add("tripadvisor", url);
    else if (FACEBOOK.test(host)) add("facebook", url);
    else if (TIKTOK.test(host)) add("tiktok", url);
    else if (MAPS.test(url)) add("maps", url);
    else if (HUBS.test(host)) add("hubs", url);
    else if (NOT_WEBSITE.test(host)) continue;
    else {
      const strong = sameText(name, title) || tokens(name).some((t) => fold(host).includes(t));
      const score = tokens(name).filter((t) => fold(`${title} ${host} ${snippet}`).includes(t)).length;
      candidates.push({ url, title, snippet, score, strong });
    }
  }
  candidates.sort((a, b) => Number(b.strong) - Number(a.strong) || b.score - a.score);
  for (const c of candidates) add("website", c.url);
  return {
    website: candidates.find((c) => c.strong)?.url ?? candidates[0]?.url ?? "",
    instagram: links.instagram[0] ?? "",
    tripadvisor: links.tripadvisor[0] ?? "",
    facebook: links.facebook[0] ?? "",
    tiktok: links.tiktok[0] ?? "",
    mapsUrl: links.maps[0] ?? "",
    hubs: links.hubs,
    candidates: candidates.slice(0, 5).map(({ url, title }) => ({ url, title })),
  };
}

/**
 * Runs the search for a restaurant and returns its candidate links. Tries every
 * endpoint until one returns results; if all answer but none has results, the
 * empty result is returned so the caller still says "no results" rather than
 * "failed". Throws only when no endpoint answers.
 */
export async function searchWeb({ name, location = "" }) {
  const query = [name, location, "restaurant"].filter(Boolean).join(" ");
  const qs = new URLSearchParams({ q: query }).toString();
  let lastError, empty;
  for (const base of DDG) {
    let r;
    try { r = await fetchText(`${base}?${qs}`, { headers: { accept: "text/html" } }); }
    catch (e) { lastError = e; continue; }
    if (!r.ok) { lastError = new Error(`DuckDuckGo ${r.status}`); continue; }
    const results = parseSearchResults(r.text);
    const found = { source: "search", url: r.url, query, results, ...classifyResults(results, { name }) };
    if (results.length) return found;
    empty = found;
  }
  if (empty) return empty;
  throw lastError ?? new Error("DuckDuckGo search failed");
}
