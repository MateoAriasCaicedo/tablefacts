// Reads a restaurant's own web pages (and link-in-bio hubs like Linktree, and a
// TripAdvisor page when it lets us in) with plain fetch and regexes: no HTML
// parser dependency. Falls back to Playwright when a page renders client-side.
import { loadPlaywright } from "../../lib/playwright.mjs";
import { fetchText, sleep, BROWSER_UA } from "./util.mjs";
import { fromOsm, fromSpec } from "./hours.mjs";

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });

const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
};
const abs = (u, base) => { try { return new URL(u, base).href; } catch { return null; } };
const strip = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "accounts", "tv", "stories", "share", "direct", "about", "legal", "web", "developer"]);
const RESERVE = /(opentable|resy\.com|thefork|eltenedor|exploretock|sevenrooms|covermanager|quandoo|tablein|mesa247|bookatable|tablecheck|resos\.com|reservandonos|agendapro|fudo\.)/i;
const DELIVERY = /(rappi|ubereats|pedidosya|doordash|grubhub|domicilios\.com|didi-food|glovoapp)/i;
const HUBS = /(linktr\.ee|beacons\.ai|bio\.link|lnk\.bio|linktree\.com|taplink|campsite\.bio|solo\.to|linkin\.bio|flow\.page)/i;
const DAY_RE = /\b(lun(es)?|mar(tes)?|mi[eé](rcoles)?|jue(ves)?|vie(rnes)?|s[aá]b(ado)?|dom(ingo)?|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/i;
const TIME_RE = /\d{1,2}([:.]\d{2})?\s*(am|pm|h|hrs)?\s*(-|–|—|a|to|hasta)\s*\d{1,2}([:.]\d{2})?/i;
const BUSINESS_TYPE = /Restaurant|FoodEstablishment|BarOrPub|CafeOrCoffeeShop|Bakery|NightClub|LocalBusiness|Hotel/;

function visibleLines(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, "");
  return decode(body.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|ul|ol|table)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function jsonLd(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(decode(m[1]).trim());
      for (const n of [data].flat()) nodes.push(...(n["@graph"] ? n["@graph"] : [n]));
    } catch { /* malformed block: skip it */ }
  }
  const biz = nodes.find((n) => BUSINESS_TYPE.test([n["@type"]].flat().join(" ")));
  if (!biz) return null;
  const addr = biz.address && typeof biz.address === "object" ? biz.address : {};
  const text = (v) => (typeof v === "string" ? v : v?.name ?? v?.url ?? "");
  return {
    name: text(biz.name),
    telephone: text(biz.telephone),
    email: text(biz.email),
    priceRange: text(biz.priceRange),
    cuisines: [biz.servesCuisine].flat().filter((c) => typeof c === "string"),
    address: { street: addr.streetAddress ?? "", locality: addr.addressLocality ?? "", region: addr.addressRegion ?? "", postcode: addr.postalCode ?? "", country: typeof addr.addressCountry === "string" ? addr.addressCountry : addr.addressCountry?.name ?? "" },
    geo: biz.geo?.latitude ? { lat: Number(biz.geo.latitude), lng: Number(biz.geo.longitude) } : null,
    sameAs: [biz.sameAs].flat().filter((u) => typeof u === "string"),
    logo: text(biz.logo),
    rating: biz.aggregateRating ? { value: Number(biz.aggregateRating.ratingValue), count: Number(biz.aggregateRating.reviewCount ?? biz.aggregateRating.ratingCount) || null } : null,
    hours: fromSpec(biz.openingHoursSpecification) ?? fromOsm([biz.openingHours].flat().filter(Boolean).join("; ")),
  };
}

/** Pulls every fact a page holds. `base` resolves relative links. */
export function analyzeHtml(html, base, lines = visibleLines(html)) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = attrs(m[1]);
    const key = (a.property || a.name || "").toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content;
  }
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: abs(attrs(m[1]).href ?? "", base), text: strip(m[2]) }))
    .filter((a) => a.href);
  // Hubs and single-page apps keep their links in JSON blobs, not in <a> tags.
  const hrefs = new Set(anchors.map((a) => a.href));
  for (const m of html.matchAll(/"(?:url|href|link)"\s*:\s*"(https?:[^"]+)"/g)) {
    const u = m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (!hrefs.has(u)) {
      hrefs.add(u);
      anchors.push({ href: u, text: "" });
    }
  }

  const links = { tel: [], mail: [], whatsapp: [], reserve: [], menu: [], delivery: [], maps: [], waze: [], facebook: [], tiktok: [], tripadvisor: [], hubs: [], instagram: [] };
  const ig = new Map();
  const push = (k, v) => { if (v && !links[k].includes(v)) links[k].push(v); };
  for (const { href, text } of anchors) {
    let u;
    try { u = new URL(href); } catch { continue; }
    const h = u.hostname.replace(/^www\./, "");
    if (u.protocol === "tel:") push("tel", decodeURIComponent(href.slice(4)).trim());
    else if (u.protocol === "mailto:") push("mail", decodeURIComponent(href.slice(7).split("?")[0]).trim());
    else if (/(^|\.)wa\.me$|whatsapp\.com$|wa\.link$/.test(h)) {
      const num = (u.pathname.match(/^\/(\d{7,})/)?.[1]) ?? u.searchParams.get("phone");
      push("whatsapp", num ? num.replace(/\D/g, "") : href);
    } else if (/(^|\.)instagram\.com$/.test(h)) {
      const handle = u.pathname.split("/")[1]?.toLowerCase();
      if (handle && !IG_RESERVED.has(handle) && /^[a-z0-9._]+$/.test(handle)) ig.set(handle, (ig.get(handle) ?? 0) + 1);
    } else if (/facebook\.com$|fb\.com$/.test(h)) push("facebook", href);
    else if (/tiktok\.com$/.test(h)) push("tiktok", href);
    else if (/tripadvisor\./.test(h)) push("tripadvisor", href);
    else if (/maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps/.test(href)) push("maps", href);
    else if (/waze\.com/.test(h)) push("waze", href);
    else if (HUBS.test(h)) push("hubs", href);
    else if (RESERVE.test(href)) push("reserve", href);
    else if (DELIVERY.test(href)) push("delivery", href);
    else if (/\.pdf($|\?)/i.test(u.pathname) || /\b(menu|men[uú]|carta)\b/i.test(`${text} ${u.pathname}`)) push("menu", href);
  }
  links.instagram = [...ig].sort((a, b) => b[1] - a[1]).map(([h]) => h);

  const images = [];
  const imageKeys = new Set();
  const addImage = (url, alt = "", extra = {}) => {
    if (!url || /^data:/.test(url) || /(icon|sprite|favicon|pixel|spacer|avatar|badge|payment|flag|tripadvisor|facebook|instagram|whatsapp)\b/i.test(url)) return;
    const key = url.split("?")[0];
    if (!imageKeys.has(key)) {
      imageKeys.add(key);
      images.push({ url, alt, ...extra });
    }
  };
  addImage(abs(meta["og:image"], base), "og:image");
  const logos = [];
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const a = attrs(m[1]);
    const srcset = (a.srcset || a["data-srcset"] || "").split(",").map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
    const best = srcset.sort((x, y) => parseInt(y[1] ?? "0") - parseInt(x[1] ?? "0"))[0]?.[0];
    const url = abs(best || a.src || a["data-src"] || a["data-lazy-src"], base);
    if (!url) continue;
    if (/logo/i.test(`${a.src} ${a.class} ${a.id} ${a.alt}`)) logos.push({ url, kind: "img" });
    else addImage(url, a.alt, { width: Number(a.width) || undefined, height: Number(a.height) || undefined });
  }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+\.(?:jpe?g|png|webp))['"]?\s*\)/gi)) addImage(abs(m[1], base));
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const a = attrs(m[1]);
    if (/apple-touch-icon|icon/.test(a.rel ?? "") && a.href) logos.push({ url: abs(a.href, base), kind: a.rel });
  }

  const ld = jsonLd(html);
  if (ld?.logo) logos.unshift({ url: abs(ld.logo, base), kind: "json-ld" });
  return {
    url: base,
    title: strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    lang: (html.match(/<html[^>]*\blang=["']?([a-zA-Z-]+)/i)?.[1] ?? "").toLowerCase(),
    meta: { siteName: meta["og:site_name"] ?? "", title: meta["og:title"] ?? "", description: meta["og:description"] ?? meta.description ?? "", themeColor: meta["theme-color"] ?? "" },
    jsonld: ld, links, images, logos,
    textLength: lines.join(" ").length,
    headings: [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => strip(m[1])).filter((t) => t && t.length < 140),
    paragraphs: lines.filter((l) => l.length >= 70 && !/[©]|cookie/i.test(l)).slice(0, 12),
    hoursText: lines.filter((l) => l.length <= 160 && ((DAY_RE.test(l) && TIME_RE.test(l)) || /^(horarios?|opening hours|hours)\b/i.test(l))),
    anchors: anchors.filter((a) => /^https?:/.test(a.href)),
  };
}

/**
 * One lazily launched Chromium shared by every render of a run. `get()` launches on first use;
 * `close()` is safe to call when nothing was launched.
 */
export function createBrowser() {
  let launching = null;
  return {
    get() {
      launching ??= loadPlaywright().then(({ chromium }) => chromium.launch());
      return launching;
    },
    async close() {
      if (!launching) return;
      const pending = launching;
      launching = null;
      try { await (await pending).close(); } catch { /* it never launched */ }
    },
  };
}

// `strict` (the caller asked for rendering) reports a missing Playwright; the automatic fallbacks stay silent.
async function render(url, strict, browser) {
  let page;
  try {
    page = await (await browser.get()).newPage({ userAgent: BROWSER_UA });
    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    return await page.content();
  } catch (e) {
    if (strict && e.code === "EDEPENDENCY") throw e;
    return null;
  } finally {
    await page?.close().catch(() => {});
  }
}

/** One page, analysed. Returns { page, blocked } and never throws on HTTP errors. `browser` is a shared createBrowser(); without one a private browser is used and closed. */
export async function readPage(url, { renderJs = false, browser } = {}) {
  const own = browser ? null : createBrowser();
  const shared = browser ?? own;
  try {
    let r;
    try { r = await fetchText(url); } catch (e) { return { page: null, blocked: `${e.message}` }; }
    if (!r.ok) {
      // Bot walls answer 403/429/503 to a plain fetch; a real browser often gets through.
      const html = [403, 429, 503].includes(r.status) ? await render(url, false, shared) : null;
      return html ? { page: { ...analyzeHtml(html, url), rendered: true } } : { page: null, blocked: `HTTP ${r.status}` };
    }
    // Decide "thin" from the visible text first, so a thin page is parsed only once (rendered) and a full one once (as fetched).
    const lines = visibleLines(r.text);
    if (renderJs || lines.join(" ").length < 300) {
      const html = await render(r.url, renderJs, shared);
      if (html) return { page: { ...analyzeHtml(html, r.url), rendered: true } };
    }
    return { page: analyzeHtml(r.text, r.url, lines) };
  } finally {
    await own?.close();
  }
}

const PAGE_HINT = /contact|ubica|visit|about|nosotros|historia|story|nuestra|menu|carta|reserv|evento|event|horario|hours|donde|find/i;

/** The restaurant's own site: the home page plus a few contact/about/menu pages, merged. */
export async function scrapeSite(startUrl, { renderJs = false, maxPages = 6, browser } = {}) {
  const own = browser ? null : createBrowser();
  try {
    return await scrape(startUrl, { renderJs, maxPages, browser: browser ?? own });
  } finally {
    await own?.close();
  }
}

async function scrape(startUrl, { renderJs, maxPages, browser }) {
  const first = await readPage(startUrl, { renderJs, browser });
  if (!first.page) throw new Error(`could not read ${startUrl} (${first.blocked})`);
  const pages = [first.page];
  const seen = new Set([first.page.url.split("#")[0]]);
  const same = host(first.page.url);
  const next = first.page.anchors
    .filter((a) => host(a.href) === same && !/\.(pdf|jpe?g|png|webp|svg|zip)($|\?)/i.test(a.href) && PAGE_HINT.test(`${a.text} ${new URL(a.href).pathname}`))
    .map((a) => a.href.split("#")[0]);
  const queue = [];
  for (const url of next) {
    if (seen.has(url)) continue;
    seen.add(url);
    queue.push(url);
  }
  // Batches of 3 pages, started 200 ms apart: it is the restaurant's own site, so no hammering.
  for (let i = 0; i < queue.length && pages.length < maxPages; ) {
    const batch = queue.slice(i, i + Math.min(3, maxPages - pages.length));
    i += batch.length;
    const read = await Promise.all(
      batch.map(async (url, n) => {
        await sleep(n * 200);
        return readPage(url, { renderJs, browser });
      }),
    );
    for (const { page } of read) if (page) pages.push(page);
  }

  const uniq = (list, key = (x) => x) => {
    const keys = new Set();
    return list.filter((x) => {
      const k = key(x);
      if (keys.has(k)) return false;
      keys.add(k);
      return true;
    });
  };
  const links = {};
  for (const k of Object.keys(pages[0].links)) links[k] = uniq(pages.flatMap((p) => p.links[k]));
  return {
    url: first.page.url,
    pages: pages.map((p) => ({ url: p.url, title: p.title, rendered: !!p.rendered })),
    lang: first.page.lang,
    meta: first.page.meta,
    jsonld: pages.map((p) => p.jsonld).find(Boolean) ?? null,
    links,
    images: uniq(pages.flatMap((p) => p.images), (i) => i.url.split("?")[0]),
    logos: uniq(pages.flatMap((p) => p.logos), (l) => l.url),
    headings: uniq(pages.flatMap((p) => p.headings)).slice(0, 30),
    paragraphs: uniq(pages.flatMap((p) => p.paragraphs)).slice(0, 20),
    hoursText: uniq(pages.flatMap((p) => p.hoursText)).slice(0, 12),
  };
}
