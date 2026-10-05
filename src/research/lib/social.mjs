// Instagram, TripAdvisor and link-in-bio hubs. All three are best-effort: they
// sit behind login walls or bot protection, so each one returns what it could
// read plus a `blocked` reason, and the report says what is missing.
import { fetchText } from "./util.mjs";
import { readPage } from "./website.mjs";

/**
 * Public Instagram profile metadata. Without a login the page only exposes the
 * share card: "1,234 Followers, 56 Following, 789 Posts - Name (@handle) on
 * Instagram: "bio"". The bio often carries the phone, the area and a hub link.
 */
export async function readInstagram(handle) {
  const url = `https://www.instagram.com/${handle}/`;
  let r;
  try { r = await fetchText(url, { headers: { accept: "text/html" } }); } catch (e) { return { handle, url, blocked: e.message }; }
  if (!r.ok) return { handle, url, blocked: `HTTP ${r.status}` };
  const meta = (key) => r.text.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? "";
  const desc = meta("og:description").replace(/&quot;/g, '"').replace(/&#039;|&#x27;/g, "'").replace(/&amp;/g, "&");
  const title = meta("og:title");
  if (!desc && !title) return { handle, url, blocked: "login wall (no public metadata)" };
  const stats = desc.match(/([\d.,KMkm]+)\s+Followers?,\s*([\d.,KMkm]+)\s+Following,\s*([\d.,KMkm]+)\s+Posts?/i);
  const bio = desc.match(/on Instagram:\s*["“]([\s\S]*?)["”]?\s*$/i)?.[1]?.trim() ?? "";
  const links = bio.match(/https?:\/\/[^\s)]+|\b[\w-]+\.(?:com|co|link|bio|ee)\/[\w./-]+/gi) ?? [];
  return {
    handle, url,
    displayName: title.replace(/\s*\(@.*$/, "").trim(),
    followers: stats?.[1] ?? "",
    posts: stats?.[3] ?? "",
    bio,
    phones: [...bio.matchAll(/\+?\d[\d\s().-]{7,}\d/g)].map((m) => m[0].trim()),
    links: links.map((l) => (/^https?:/.test(l) ? l : `https://${l}`)),
    image: meta("og:image"),
  };
}

/** TripAdvisor: schema.org JSON-LD when the page loads; DataDome often blocks it. */
export async function readTripadvisor(url) {
  const { page, blocked } = await readPage(url);
  if (!page) return { url, blocked };
  if (!page.jsonld && page.textLength < 500) return { url, blocked: "bot protection (page has no data)" };
  return { url: page.url, jsonld: page.jsonld, description: page.meta.description, hoursText: page.hoursText, images: page.images.slice(0, 10) };
}

/** A link-in-bio hub (Linktree, Beacons, bio.link): its links, classified like a website's. */
export async function readHub(url) {
  const { page, blocked } = await readPage(url, { renderJs: false });
  if (!page) return { url, blocked };
  return { url: page.url, title: page.title, meta: page.meta, links: page.links, anchors: page.anchors.filter((a) => a.text).slice(0, 30), logos: page.logos, images: page.images.slice(0, 10) };
}
