// Small helpers shared by the research sources: env file, HTTP, name matching.
import { loadEnvFiles } from "../../lib/env.mjs";

/** Loads the project's .env without overriding variables already set in the environment. */
export function loadEnv() {
  loadEnvFiles();
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 cannario-research";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { headers = {}, timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_UA, "accept-language": "es,en;q=0.8", accept: "text/html,application/json,*/*", ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  return { ok: res.ok, status: res.status, url: res.url, type: res.headers.get("content-type") ?? "", text: await res.text() };
}

export const fold = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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

export const slugify = (s) =>
  fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restaurant";

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
