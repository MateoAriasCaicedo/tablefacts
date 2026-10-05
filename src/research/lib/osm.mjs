// OpenStreetMap through Nominatim: no key, so it is the fallback when Google is
// not configured and a second opinion when it is. Policy: identify yourself and
// stay under one request per second (this makes one).
import { fetchText, sameText } from "./util.mjs";
import { fromOsm } from "./hours.mjs";

function normalize(p) {
  const a = p.address ?? {};
  const x = p.extratags ?? {};
  const tag = (...keys) => keys.map((k) => x[k]).find(Boolean) ?? "";
  return {
    source: "osm",
    name: p.name ?? p.namedetails?.name ?? "",
    street: [a.road, a.house_number].filter(Boolean).join(" "),
    locality: (a.city ?? a.town ?? a.village ?? a.municipality ?? "").replace(/^Perímetro Urbano\s+/i, ""),
    region: a.state ?? "",
    country: (a.country_code ?? "").toUpperCase(),
    postcode: a.postcode ?? "",
    coords: { lat: Number(p.lat), lng: Number(p.lon) },
    phone: tag("phone", "contact:phone"),
    whatsapp: tag("contact:whatsapp"),
    email: tag("email", "contact:email"),
    website: tag("website", "contact:website"),
    instagram: tag("contact:instagram"),
    facebook: tag("contact:facebook"),
    cuisines: (x.cuisine ?? "").split(";").map((c) => c.trim().replace(/_/g, " ")).filter(Boolean).map((c) => c[0].toUpperCase() + c.slice(1)),
    hours: fromOsm(x.opening_hours),
    hoursRaw: x.opening_hours ?? "",
    osmUrl: p.osm_type && p.osm_id ? `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` : "",
  };
}

export async function searchOsm({ name, location, country }) {
  const params = new URLSearchParams({
    q: `${name}, ${location}`.replace(/,\s*$/, ""),
    format: "jsonv2", addressdetails: "1", extratags: "1", namedetails: "1", limit: "5",
    ...(country && { countrycodes: country.toLowerCase() }),
  });
  const r = await fetchText(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "user-agent": "cannario-research/1.0 (restaurant site template)", accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const list = JSON.parse(r.text);
  const hit = list.find((p) => sameText(p.name ?? p.namedetails?.name ?? "", name));
  return {
    place: hit ? normalize(hit) : null,
    candidates: list.map((p) => ({ name: p.name ?? "", address: p.display_name })),
  };
}
