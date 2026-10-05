// Instagram, TripAdvisor and link-in-bio hubs. All three are best-effort: they
// sit behind login walls or bot protection, so each one returns what it could
// read plus a `blocked` reason, and the report says what is missing.
import { fetchText, sleep, decodeHtml as decodeEntities } from "./util.mjs";
import { readPage } from "./website.mjs";

// Instagram's own web app sends this app id with its public profile request; no
// login is involved, and the request identifies honestly.
const IG_APP_ID = "936619743392459";
// A short gap between the Instagram surfaces: one walled profile should not become a burst.
const SURFACE_PAUSE = 300;

const bioLinks = (bio) => (bio.match(/https?:\/\/[^\s)]+|\b[\w-]+\.(?:com|co|link|bio|ee)\/[\w./-]+/gi) ?? [])
  .map((l) => (/^https?:/.test(l) ? l : `https://${l}`));
const bioPhones = (bio) => [...bio.matchAll(/\+?\d[\d\s().-]{7,}\d/g)].map((m) => m[0].trim());

/** The public share card: "1,234 Followers, 56 Following, 789 Posts - Name (@handle) on Instagram: "bio"". */
function shareCard(html) {
  const meta = (key) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ?? "";
  const desc = decodeEntities(meta("og:description"));
  const title = decodeEntities(meta("og:title"));
  if (!desc && !title) return null;
  return { title, desc, image: meta("og:image") };
}

function fromCard(handle, url, card, surface) {
  const desc = card.desc;
  const stats = desc.match(/([\d.,KMkm]+)\s+Followers?,\s*([\d.,KMkm]+)\s+Following,\s*([\d.,KMkm]+)\s+Posts?/i);
  const wrapped = desc.match(/on Instagram:\s*["“]([\s\S]*?)["”]?\s*$/i)?.[1]?.trim();
  // A bare bio snippet has no share-card wrapper; a stats-only line has no bio.
  const bio = wrapped ?? (/Followers?,\s*[\d.,KMkm]+\s+Following/i.test(desc) ? "" : desc.trim());
  return {
    handle, url, surface,
    displayName: card.title.replace(/\s*\(@.*$/, "").trim(),
    followers: stats?.[1] ?? "",
    posts: stats?.[3] ?? "",
    bio,
    phones: bioPhones(bio),
    links: bioLinks(bio),
    image: card.image,
  };
}

/** Fills in a missing bio or counts from the search-engine snippet, keeping whatever the surface itself gave. */
function withSnippet(result, snippet) {
  if (!snippet) return result;
  const merged = fromCard(result.handle, result.url, { title: result.displayName ?? "", desc: snippet, image: result.image ?? "" }, result.surface);
  return {
    ...result,
    followers: result.followers || merged.followers,
    posts: result.posts || merged.posts,
    bio: result.bio || merged.bio || snippet,
    phones: result.phones?.length ? result.phones : merged.phones,
    links: result.links?.length ? result.links : merged.links,
  };
}

/** The public web_profile_info endpoint the profile page calls. No login, but often walled. */
async function readProfileApi(handle) {
  const url = `https://www.instagram.com/${handle}/`;
  let r;
  try { r = await fetchText(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, { headers: { accept: "application/json", "x-ig-app-id": IG_APP_ID } }); }
  catch { return null; }
  if (!r.ok) return null;
  let user;
  try { user = JSON.parse(r.text)?.data?.user; } catch { return null; }
  if (!user) return null;
  const bio = user.biography ?? "";
  return {
    handle, url, surface: "profile API",
    displayName: user.full_name ?? "",
    followers: user.edge_followed_by?.count != null ? String(user.edge_followed_by.count) : "",
    posts: user.edge_owner_to_timeline_media?.count != null ? String(user.edge_owner_to_timeline_media.count) : "",
    bio,
    phones: bioPhones(bio),
    links: bioLinks(bio),
    image: user.profile_pic_url_hd ?? user.profile_pic_url ?? "",
  };
}

/** oEmbed (public, though Instagram now usually wants an app token): display name only. */
async function readOembed(handle, url) {
  let r;
  try { r = await fetchText(`https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`, { headers: { accept: "application/json" } }); }
  catch { return null; }
  if (!r.ok) return null;
  let j;
  try { j = JSON.parse(r.text); } catch { return null; }
  if (!j?.author_name && !j?.title) return null;
  return { handle, url, surface: "oembed", displayName: j.author_name ?? "", followers: "", posts: "", bio: "", phones: [], links: [], image: "" };
}

/**
 * Public Instagram profile metadata, trying the public surfaces in turn: the
 * share card, the web profile API, oEmbed, and finally the bio a search engine
 * indexed (`snippet`). Only honest requests are made; a walled profile is
 * reported as blocked, never worked around. Returns `blocked` only when none of
 * them had anything.
 */
export async function readInstagram(handle, { snippet = "" } = {}) {
  const url = `https://www.instagram.com/${handle}/`;
  let reason = "";

  try {
    const r = await fetchText(url, { headers: { accept: "text/html" } });
    if (!r.ok) reason = `HTTP ${r.status}`;
    else {
      const card = shareCard(r.text);
      if (card) return withSnippet(fromCard(handle, url, card, "share card"), snippet);
    }
  } catch (e) { reason = e.message; }

  await sleep(SURFACE_PAUSE);
  const fromApi = await readProfileApi(handle);
  if (fromApi) return withSnippet(fromApi, snippet);

  await sleep(SURFACE_PAUSE);
  const oembed = await readOembed(handle, url);
  if (oembed) return withSnippet(oembed, snippet);

  if (snippet) return { ...fromCard(handle, url, { title: "", desc: snippet, image: "" }, "search snippet"), partial: true };

  return { handle, url, blocked: reason || "login wall (no public metadata on any surface)" };
}

/**
 * Name and location out of a TripAdvisor restaurant URL slug, e.g.
 * "...-Reviews-Maki_Bar_Medellin-Medellin_Antioquia_Department.html" gives
 * { name: "Maki Bar Medellin", location: "Medellin Antioquia Department" }. The
 * city/region boundary is ambiguous for multi-word cities, so the whole location
 * is kept and the caller treats it as a hint, never as a confirmed locality.
 */
export function parseTripadvisorUrl(raw) {
  let path;
  try { path = new URL(raw).pathname; } catch { return null; }
  const segment = path.split("/").find((s) => /-Reviews-|-ShowUserReviews-|-Management-/.test(s));
  if (!segment) return null;
  const after = segment.split(/-(?:Reviews|ShowUserReviews|Management)-/).pop()?.replace(/\.html?$/i, "") ?? "";
  const [namePart = "", locationPart = ""] = after.split("-");
  const words = (s) => decodeEntities(s).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const name = words(namePart);
  const location = words(locationPart);
  return name ? { name, location } : null;
}

/** TripAdvisor: schema.org JSON-LD when the page loads; DataDome often blocks it. The URL slug is always kept. */
export async function readTripadvisor(url, { browser } = {}) {
  const slug = parseTripadvisorUrl(url);
  const { page, blocked } = await readPage(url, { browser });
  if (!page) return { url, slug, blocked };
  if (!page.jsonld && page.textLength < 500) return { url, slug, blocked: "bot protection (page has no data)" };
  return { url: page.url, slug, jsonld: page.jsonld, description: page.meta.description, hoursText: page.hoursText, images: page.images.slice(0, 10) };
}

/** A link-in-bio hub (Linktree, Beacons, bio.link): its links, classified like a website's. */
export async function readHub(url, { browser } = {}) {
  const { page, blocked } = await readPage(url, { renderJs: false, browser });
  if (!page) return { url, blocked };
  return { url: page.url, title: page.title, meta: page.meta, links: page.links, anchors: page.anchors.filter((a) => a.text).slice(0, 30), logos: page.logos, images: page.images.slice(0, 10) };
}
