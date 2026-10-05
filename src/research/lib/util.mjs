// Small helpers shared by the research sources: HTTP, name matching.
import { fold, slugify as slug } from "../../lib/text.mjs";

export { fold };

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 cannario-research";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities a page's attributes or text may hold, named and numeric. */
export const decodeHtml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") {
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return HTML_ENT[e.toLowerCase()] ?? m;
});

// Instagram paths that are not a profile.
export const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "accounts", "tv", "stories", "share", "direct", "about", "legal", "web", "developer"]);

/** The profile handle in an instagram.com URL, or "" for a post, reel or other non-profile path. */
export const instagramHandle = (url) => {
  try {
    const h = new URL(url).pathname.split("/")[1]?.toLowerCase();
    return h && !IG_RESERVED.has(h) && /^[a-z0-9._]+$/.test(h) ? h : "";
  } catch { return ""; }
};

/** Runs `fn(item, index)` over `items` with at most `size` in flight; results keep the order of `items`. */
export async function mapPool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const BINARY_TYPE = /^\s*(image|video|audio|font)\/|application\/(pdf|zip|gzip|octet-stream|vnd\.[\w.+-]*(?:excel|powerpoint|ms-)[\w.+-]*)/i;

async function readCapped(res, cap) {
  const declared = Number(res.headers.get("content-length"));
  const reader = res.body?.getReader?.();
  if (!reader) {
    // No stream (a minimal Response-like): read it whole, then cut.
    const text = await res.text();
    return text.length > cap ? { text: text.slice(0, cap), truncated: true } : { text, truncated: false };
  }
  const chunks = [];
  let size = 0;
  let truncated = Number.isFinite(declared) && declared > cap;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  if (size >= cap) {
    truncated = true;
    await reader.cancel().catch(() => {});
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).subarray(0, cap);
  return { text: buf.toString("utf8"), truncated };
}

/**
 * GETs a URL as text. The body is capped at 2 MB (`truncated: true` when it was cut, never an error) and a
 * clearly binary content-type (image, pdf, zip...) is not read at all (`skipped: true`, empty text).
 */
export async function fetchText(url, { headers = {}, timeout = 15000, maxBytes = MAX_BODY_BYTES } = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_UA, "accept-language": "es,en;q=0.8", accept: "text/html,application/json,*/*", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  const type = res.headers.get("content-type") ?? "";
  const head = { ok: res.ok, status: res.status, url: res.url, type };
  if (BINARY_TYPE.test(type)) {
    await res.body?.cancel?.().catch?.(() => {});
    return { ...head, text: "", skipped: true };
  }
  const { text, truncated } = await readCapped(res, maxBytes);
  return truncated ? { ...head, text, truncated: true } : { ...head, text };
}

const STOP = new Set(["restaurante", "restaurant", "bar", "the", "el", "la", "los", "las", "de", "del", "y", "and", "cafe", "gastro", "grill", "bistro", "calle", "carrera", "cra", "cl", "av", "avenida"]);
export const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));

/** Loose text match: at least 60% of the shorter side's words appear in the other. */
export function sameText(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return fold(a).trim() === fold(b).trim();
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size) >= 0.6;
}

export const slugify = (s) => slug(s) || "restaurant";

export const digits = (s) => String(s ?? "").replace(/\D/g, "");

/** Same phone number written differently (spaces, +country, leading 0). */
export const samePhone = (a, b) => {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 7 && y.length >= 7 && x.slice(-9) === y.slice(-9);
};

/** Distance in km between two { lat, lng } points. */
export function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
