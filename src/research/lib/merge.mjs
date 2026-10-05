// Reconciles what each source said into one profile. Every field keeps where it
// came from, how sure we are, and what the other sources said instead: BRIEF.md
// warns that Google, TripAdvisor and the restaurant's own site disagree.
import { digits, fold, km, samePhone, sameText } from "./util.mjs";
import { formatRows, weekSignature } from "./hours.mjs";

const ES = new Set(["CO", "MX", "ES", "AR", "CL", "PE", "EC", "UY", "VE", "BO", "PY", "CR", "PA", "DO", "GT", "HN", "SV", "NI", "CU", "PR"]);
const present = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
const handleOf = (v) => String(v ?? "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();

/**
 * First candidate wins (list them most trusted first). Confidence: high when two
 * sources agree, medium for one, low for a guess (`low: true`).
 */
function choose(candidates, same = (a, b) => fold(a) === fold(b)) {
  const list = candidates.filter((c) => present(c.value));
  if (!list.length) return null;
  const first = list[0];
  const agree = list.filter((c) => same(c.value, first.value));
  const alternatives = list.filter((c) => !same(c.value, first.value)).map(({ value, source }) => ({ value, source }));
  const sources = [...new Set(agree.map((c) => c.source))];
  return {
    value: first.value,
    source: sources.join(" + "),
    confidence: first.low ? "low" : sources.length > 1 ? "high" : "medium",
    ...(alternatives.length && { alternatives }),
  };
}

const cleanUrl = (u) => {
  try {
    const x = new URL(u);
    [...x.searchParams.keys()].filter((k) => /^utm_|^fbclid|^gclid/.test(k)).forEach((k) => x.searchParams.delete(k));
    return x.href.replace(/\/$/, "");
  } catch { return u; }
};

export function buildProfile({ query, google, osm, site, hub, instagram, tripadvisor }) {
  const g = google ?? {};
  const o = osm ?? {};
  const ld = site?.jsonld ?? null;
  const ta = tripadvisor?.jsonld ?? null;
  const warnings = [];
  const ok = (v) => (v ? v : undefined);
  const hubLinks = hub?.links ?? {};
  const links = (k) => [...(site?.links?.[k] ?? []), ...(hubLinks[k] ?? [])];

  if (g.status && g.status !== "OPERATIONAL") warnings.push(`Google lists this place as ${g.status}.`);
  if (g.coords && o.coords && km(g.coords, o.coords) > 0.5) warnings.push("Google and OpenStreetMap place it more than 500 m apart: check they are the same restaurant.");
  if (!google && !osm) warnings.push("No Google or OpenStreetMap match: facts rely on the website and social pages only.");

  const coordSame = (a, b) => km(a, b) < 0.15;
  const phoneSame = samePhone;
  const igLinks = [...(site?.links?.instagram ?? []), ...(hubLinks.instagram ?? [])];

  const fields = {
    name: choose([{ value: g.name, source: "google" }, { value: ld?.name, source: "website" }, { value: ta?.name, source: "tripadvisor" }, { value: o.name, source: "osm" }, { value: site?.meta.siteName, source: "website" }], sameText),
    street: choose([{ value: g.street, source: "google" }, { value: ld?.address.street, source: "website" }, { value: ta?.address.street, source: "tripadvisor" }, { value: o.street, source: "osm" }], sameText),
    locality: choose([{ value: g.locality, source: "google" }, { value: ld?.address.locality, source: "website" }, { value: o.locality, source: "osm" }], sameText),
    region: choose([{ value: g.region, source: "google" }, { value: ld?.address.region, source: "website" }, { value: o.region, source: "osm" }], sameText),
    country: choose([{ value: query.country?.toUpperCase(), source: "you" }, { value: g.country, source: "google" }, { value: o.country, source: "osm" }, { value: ld?.address.country.length === 2 ? ld.address.country.toUpperCase() : "", source: "website" }]),
    coordinates: choose([{ value: g.coords, source: "google" }, { value: o.coords, source: "osm" }, { value: ld?.geo, source: "website" }], coordSame),
    phone: choose([{ value: g.phone, source: "google" }, { value: ok(links("tel")[0]), source: "website" }, { value: ld?.telephone, source: "website" }, { value: ta?.telephone, source: "tripadvisor" }, { value: instagram?.phones?.[0], source: "instagram" }, { value: o.phone, source: "osm" }], phoneSame),
    email: choose([{ value: ld?.email, source: "website" }, { value: links("mail").find((m) => !/sentry|wixpress|example|domain\./i.test(m)), source: "website" }, { value: o.email, source: "osm" }]),
    instagram: choose([{ value: query.instagram && handleOf(query.instagram), source: "you" }, ...igLinks.map((h) => ({ value: h, source: "website" })), ...(ld?.sameAs ?? []).filter((u) => /instagram\.com/.test(u)).map((u) => ({ value: handleOf(u), source: "website" })), { value: o.instagram && handleOf(o.instagram), source: "osm" }]),
    facebook: choose([{ value: links("facebook")[0], source: "website" }, { value: o.facebook, source: "osm" }]),
    tiktok: choose([{ value: links("tiktok")[0], source: "website" }]),
    tripadvisor: choose([{ value: query.tripadvisor, source: "you" }, { value: links("tripadvisor")[0], source: "website" }, { value: (ld?.sameAs ?? []).find((u) => /tripadvisor\./.test(u)), source: "website" }]),
    website: choose([{ value: query.website && cleanUrl(query.website), source: "you" }, { value: g.website && cleanUrl(g.website), source: "google" }, { value: o.website && cleanUrl(o.website), source: "osm" }]),
    reserveUrl: choose([...links("reserve").map((u) => ({ value: u, source: "website" }))]),
    priceRange: choose([{ value: g.priceRange, source: "google" }, { value: ld?.priceRange, source: "website" }, { value: ta?.priceRange, source: "tripadvisor" }]),
    mapsUrl: choose([{ value: g.mapsUrl, source: "google" }, { value: links("maps")[0], source: "website" }]),
    descriptor: choose([{ value: g.descriptor, source: "google" }]),
  };

  // WhatsApp: an explicit link wins; otherwise the phone is only a guess.
  const wa = [...links("whatsapp"), o.whatsapp].map(digits).find((d) => d.length >= 7);
  const phoneDisplay = (n) => [g.phone, ...(links("tel")), ld?.telephone].find((p) => p && p.trim().startsWith("+") && samePhone(p, n)) ?? `+${digits(n)}`;
  if (wa) fields.whatsapp = { value: wa, display: phoneDisplay(wa), source: site?.links?.whatsapp?.length ? "website" : hubLinks.whatsapp?.length ? "link-in-bio" : "osm", confidence: "medium" };
  else if (fields.phone) fields.whatsapp = { value: digits(fields.phone.value), display: fields.phone.value, source: fields.phone.source, confidence: "low", note: "Guess: the phone number. Confirm that it takes WhatsApp." };

  const cuisines = [...new Set([...(g.cuisines ?? []), ...(ld?.cuisines ?? []), ...(ta?.cuisines ?? []), ...(o.cuisines ?? [])].map((c) => c.trim()).filter(Boolean))];
  if (cuisines.length) {
    const from = [g.cuisines?.length && "google", ld?.cuisines?.length && "website", ta?.cuisines?.length && "tripadvisor", o.cuisines?.length && "osm"].filter(Boolean);
    fields.cuisines = { value: cuisines, source: from.join(" + "), confidence: from.length > 1 ? "high" : "medium" };
  }

  const lang = (site?.lang ?? "").slice(0, 2);
  const country = fields.country?.value;
  const menuLocale = ["es", "en"].includes(lang) ? lang : ES.has(country) ? "es" : country ? "en" : "";
  if (menuLocale) fields.menuLocale = { value: menuLocale, source: ["es", "en"].includes(lang) ? "website language" : "country", confidence: "low", note: "Guess. The language the dish names are written in decides this." };

  // Hours: the restaurant's own markup first, then Google, then OSM.
  const hourSources = [
    { source: "website", week: ld?.hours?.week },
    { source: "tripadvisor", week: ta?.hours?.week },
    { source: "google", week: g.hours?.week },
    { source: "osm", week: o.hours?.week, partial: o.hours?.partial },
  ].filter((h) => h.week);
  const hours = hourSources.length
    ? {
        source: hourSources[0].source,
        week: hourSources[0].week,
        rows: { es: formatRows(hourSources[0].week, "es"), en: formatRows(hourSources[0].week, "en") },
        confidence: hourSources.filter((h) => weekSignature(h.week) === weekSignature(hourSources[0].week)).length > 1 ? "high" : "medium",
        conflicts: hourSources.filter((h) => weekSignature(h.week) !== weekSignature(hourSources[0].week)).map((h) => ({ source: h.source, rows: formatRows(h.week, "en") })),
      }
    : null;

  return {
    query, generatedAt: new Date().toISOString(), warnings, fields, hours,
    textHours: [...(site?.hoursText ?? [])],
    links: { menu: links("menu"), delivery: links("delivery"), reserve: links("reserve"), waze: links("waze"), hubs: [...new Set([...(site?.links?.hubs ?? []), ...(instagram?.links ?? []).filter((l) => /linktr|beacons|bio\.link|lnk\.bio|taplink/.test(l))])] },
    ratings: [g.rating && { source: "google", value: g.rating, count: g.ratingCount }, ld?.rating && { source: "website", ...ld.rating }, ta?.rating && { source: "tripadvisor", ...ta.rating }].filter(Boolean),
    images: { logos: [...(site?.logos ?? []), ...(hub?.logos ?? [])].filter((l) => l.url), site: site?.images ?? [], hub: hub?.images ?? [], googlePhotos: g.photos?.length ?? 0, instagramImage: instagram?.image ?? "", themeColor: site?.meta.themeColor ?? "" },
    copySources: { googleSummary: g.summary ?? "", siteDescription: site?.meta.description ?? "", instagramBio: instagram?.bio ?? "", tripadvisor: tripadvisor?.description ?? "", headings: site?.headings ?? [], paragraphs: site?.paragraphs ?? [] },
    social: { instagram: instagram ? { handle: instagram.handle, followers: instagram.followers, posts: instagram.posts, blocked: instagram.blocked } : null },
  };
}
