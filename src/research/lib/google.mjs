// Google Places API (New): the best single source for address, map point,
// phone, hours and photos. Needs GOOGLE_PLACES_API_KEY in .env.
import { fromGoogle } from "./hours.mjs";
import { sameText } from "./util.mjs";

const FIELDS = [
  "id", "displayName", "formattedAddress", "addressComponents", "location", "nationalPhoneNumber",
  "internationalPhoneNumber", "websiteUri", "googleMapsUri", "regularOpeningHours", "priceLevel",
  "rating", "userRatingCount", "types", "primaryTypeDisplayName", "editorialSummary", "photos",
  "businessStatus", "reservable",
].map((f) => `places.${f}`).join(",");

const GENERIC_TYPES = new Set(["restaurant", "fast_food_restaurant", "family_restaurant", "meal_takeaway", "meal_delivery", "food_court", "buffet_restaurant"]);
const PRICE = { PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };

const component = (place, ...types) => {
  for (const t of types) {
    const c = place.addressComponents?.find((x) => x.types?.includes(t));
    if (c) return c;
  }
  return null;
};

/** "italian_restaurant" -> "Italian", "steak_house" -> "Steakhouse". */
function cuisinesFromTypes(types = []) {
  const out = [];
  for (const t of types) {
    if (GENERIC_TYPES.has(t)) continue;
    const m = t.match(/^(.+)_restaurant$/);
    if (m) out.push(m[1].split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "));
    else if (t === "steak_house") out.push("Steakhouse");
  }
  return out;
}

function normalize(p) {
  return {
    source: "google",
    id: p.id,
    name: p.displayName?.text ?? "",
    formattedAddress: p.formattedAddress ?? "",
    // The first comma-separated part is the street line in every format Google uses.
    street: (p.formattedAddress ?? "").split(",")[0].trim(),
    locality: (component(p, "locality", "administrative_area_level_2", "sublocality")?.longText) ?? "",
    region: component(p, "administrative_area_level_1")?.longText ?? "",
    country: component(p, "country")?.shortText ?? "",
    postcode: component(p, "postal_code")?.longText ?? "",
    coords: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    phone: p.internationalPhoneNumber ?? "",
    nationalPhone: p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    mapsUrl: p.googleMapsUri ?? "",
    hours: fromGoogle(p.regularOpeningHours?.periods),
    priceRange: PRICE[p.priceLevel] ?? "",
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    cuisines: cuisinesFromTypes(p.types),
    types: p.types ?? [],
    descriptor: p.primaryTypeDisplayName?.text ?? "",
    summary: p.editorialSummary?.text ?? "",
    status: p.businessStatus ?? "",
    reservable: p.reservable ?? null,
    photos: (p.photos ?? []).map((ph) => ({ name: ph.name, width: ph.widthPx, height: ph.heightPx, authors: (ph.authorAttributions ?? []).map((a) => a.displayName) })),
  };
}

/** Returns { place, candidates }: `place` is the first result whose name matches, or null. */
export async function searchGoogle({ name, location, country, key }) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": FIELDS },
    body: JSON.stringify({ textQuery: `${name} ${location}`.trim(), maxResultCount: 5, ...(country && { regionCode: country }) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const places = ((await res.json()).places ?? []).map(normalize);
  return {
    place: places.find((p) => sameText(p.name, name)) ?? null,
    candidates: places.map((p) => ({ name: p.name, address: p.formattedAddress, status: p.status })),
  };
}

/** Downloads up to `count` photos into `dir`, returns what was saved. The key stays out of the result. */
export async function downloadPhotos(place, key, count, save) {
  const saved = [];
  for (const [i, ph] of place.photos.slice(0, count).entries()) {
    const res = await fetch(`https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=2400&key=${key}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) continue;
    const file = `google-${String(i + 1).padStart(2, "0")}.jpg`;
    await save(file, Buffer.from(await res.arrayBuffer()));
    saved.push({ file, width: ph.width, height: ph.height, authors: ph.authors });
  }
  return saved;
}
