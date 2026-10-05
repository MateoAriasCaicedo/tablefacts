/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mod1 from "../src/research/lib/google.mjs";
const { downloadPhotos, searchGoogle } = mod1 as Record<string, any>;
import * as mod2 from "../src/research/lib/osm.mjs";
const { searchOsm } = mod2 as Record<string, any>;
import * as mod3 from "../src/research/lib/social.mjs";
const { readHub, readInstagram, readTripadvisor } = mod3 as Record<string, any>;
import * as mod4 from "../src/research/lib/website.mjs";
const { analyzeHtml, readPage, scrapeSite } = mod4 as Record<string, any>;

type Anything = Record<string, any>;

afterEach(() => vi.unstubAllGlobals());

/** A route table standing in for the network: URL -> status and body. */
function network(routes: Record<string, { status?: number; body?: string; type?: string; json?: unknown } | Error>) {
  const calls: { url: string; init?: Anything }[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: Anything) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!hit) return respond(404, "not found", url);
    if (hit instanceof Error) throw hit;
    const body = hit.json !== undefined ? JSON.stringify(hit.json) : hit.body ?? "";
    return respond(hit.status ?? 200, body, url, hit.type);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function respond(status: number, body: string, url: string, type = "text/html") {
  return {
    ok: status < 400,
    status,
    url,
    headers: { get: (name: string) => (name === "content-type" ? type : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

/** Enough visible text that readPage does not decide the page needs a browser:
    under 300 characters it would launch a real one (Playwright), which no test
    may do, so every fixture page is kept above that. */
const filler = `<p>${"Cocina de brasa en el corazón de la ciudad. ".repeat(12)}</p>`;

const page = (head: string, body: string, lang = "es") =>
  `<!doctype html><html lang="${lang}"><head><title>Gaucho | Medellín</title>${head}</head><body>${body}${filler}</body></html>`;

describe("analyzeHtml", () => {
  const html = page(
    `<meta property="og:site_name" content="Gaucho">
     <meta property="og:description" content="Parrilla argentina &amp; vinos">
     <meta property="og:image" content="/img/hero.jpg">
     <meta name="theme-color" content="#101010">
     <link rel="apple-touch-icon" href="/apple.png">
     <script type="application/ld+json">${JSON.stringify({
       "@context": "https://schema.org",
       "@graph": [
         { "@type": "WebSite", name: "ignored" },
         {
           "@type": ["Restaurant", "FoodEstablishment"],
           name: "Gaucho",
           telephone: "+57 300 123 4567",
           priceRange: "$$",
           servesCuisine: ["Argentine", "Steakhouse"],
           address: { streetAddress: "Cra 35 # 8-30", addressLocality: "Medellín", addressRegion: "Antioquia", addressCountry: "CO" },
           geo: { latitude: "6.2", longitude: "-75.57" },
           sameAs: ["https://www.instagram.com/casa_gaucho/"],
           logo: "/logo.svg",
           aggregateRating: { ratingValue: "4.6", reviewCount: "210" },
           openingHoursSpecification: [{ dayOfWeek: "Monday", opens: "12:00", closes: "22:00" }],
         },
       ],
     })}</script>`,
    `<h1>Gaucho</h1><h2>Nuestra historia</h2>
     <a href="tel:+573001234567">Llamar</a>
     <a href="mailto:hola@gaucho.co?subject=x">Escríbenos</a>
     <a href="https://wa.me/573001234567?text=hola">WhatsApp</a>
     <a href="https://www.instagram.com/casa_gaucho/">IG</a>
     <a href="https://www.instagram.com/casa_gaucho/">IG again</a>
     <a href="https://www.instagram.com/p/ABC/">a post, not a profile</a>
     <a href="https://www.facebook.com/gaucho">FB</a>
     <a href="https://www.tripadvisor.com/Restaurant_Review-1">TA</a>
     <a href="https://www.opentable.com/r/gaucho">Reservar</a>
     <a href="https://www.rappi.com.co/gaucho">Pedir</a>
     <a href="https://linktr.ee/gaucho">links</a>
     <a href="https://waze.com/ul?ll=6.2,-75.5">Waze</a>
     <a href="https://maps.app.goo.gl/abc">Mapa</a>
     <a href="/carta.pdf">Nuestra carta</a>
     <img src="/img/logo-gaucho.png" alt="Gaucho logo">
     <img src="/img/plato.jpg" alt="Un plato" width="800" height="600">
     <img src="/img/icon-star.png" alt="">
     <div style="background:url('/img/sala.webp')"></div>
     <p>Lunes a viernes 12:00 - 22:00</p>
     <p>Horarios</p>`,
  );
  const result: Anything = analyzeHtml(html, "https://gaucho.co/");

  it("reads the title, the language and the social tags", () => {
    expect(result.title).toBe("Gaucho | Medellín");
    expect(result.lang).toBe("es");
    expect(result.meta).toEqual({ siteName: "Gaucho", title: "", description: "Parrilla argentina & vinos", themeColor: "#101010" });
  });

  it("reads the restaurant out of the structured data, even inside a @graph", () => {
    expect(result.jsonld).toMatchObject({
      name: "Gaucho",
      telephone: "+57 300 123 4567",
      priceRange: "$$",
      cuisines: ["Argentine", "Steakhouse"],
      address: { street: "Cra 35 # 8-30", locality: "Medellín", region: "Antioquia", country: "CO" },
      geo: { lat: 6.2, lng: -75.57 },
      rating: { value: 4.6, count: 210 },
    });
    expect(result.jsonld.hours.week[0]).toEqual([["12:00", "22:00"]]);
  });

  it("sorts links by what they are", () => {
    const { links } = result;
    expect(links.tel).toEqual(["+573001234567"]);
    expect(links.mail).toEqual(["hola@gaucho.co"]);
    expect(links.whatsapp).toEqual(["573001234567"]);
    expect(links.facebook).toEqual(["https://www.facebook.com/gaucho"]);
    expect(links.tripadvisor).toEqual(["https://www.tripadvisor.com/Restaurant_Review-1"]);
    expect(links.reserve).toEqual(["https://www.opentable.com/r/gaucho"]);
    expect(links.delivery).toEqual(["https://www.rappi.com.co/gaucho"]);
    expect(links.hubs).toEqual(["https://linktr.ee/gaucho"]);
    expect(links.waze).toHaveLength(1);
    expect(links.maps).toEqual(["https://maps.app.goo.gl/abc"]);
    expect(links.menu).toEqual(["https://gaucho.co/carta.pdf"]);
  });

  it("finds the Instagram profile and not a post", () => {
    expect(result.links.instagram).toEqual(["casa_gaucho"]);
  });

  it("collects images, leaving out icons, and keeps the logo apart", () => {
    const urls = result.images.map((i: Anything) => i.url);
    expect(urls).toContain("https://gaucho.co/img/hero.jpg");
    expect(urls).toContain("https://gaucho.co/img/plato.jpg");
    expect(urls).toContain("https://gaucho.co/img/sala.webp");
    expect(urls.some((u: string) => u.includes("icon-star"))).toBe(false);
    expect(urls.some((u: string) => u.includes("logo"))).toBe(false);
    expect(result.images.find((i: Anything) => i.url.endsWith("plato.jpg"))).toMatchObject({ width: 800, height: 600 });
    const logos = result.logos.map((l: Anything) => l.url);
    expect(logos).toEqual(expect.arrayContaining(["https://gaucho.co/logo.svg", "https://gaucho.co/img/logo-gaucho.png", "https://gaucho.co/apple.png"]));
  });

  it("picks out hours written as text", () => {
    expect(result.hoursText).toEqual(["Lunes a viernes 12:00 - 22:00", "Horarios"]);
  });

  it("reads headings and long paragraphs for the copy", () => {
    expect(result.headings).toEqual(expect.arrayContaining(["Gaucho", "Nuestra historia"]));
    expect(result.paragraphs[0]).toContain("Cocina de brasa");
  });

  it("returns a null restaurant for a page with no structured data, and survives bad JSON", () => {
    const plain = analyzeHtml(page(`<script type="application/ld+json">{not json</script>`, ""), "https://gaucho.co/") as Anything;
    expect(plain.jsonld).toBeNull();
  });

  it("decodes numeric entities in attributes and ignores a malformed link", () => {
    const odd = analyzeHtml(`<html><body><a href="http://[bad">x</a><a href="mailto:a&#64;b.co">m</a></body></html>`, "https://x.co/") as Anything;
    expect(odd.links.mail).toEqual(["a@b.co"]);
  });

  it("finds links that only live in a JSON blob, as link-in-bio hubs keep them", () => {
    const hub = analyzeHtml(`<html><body><script>{"url":"https:\\/\\/wa.me\\/573001234567","href":"https://www.instagram.com/casa_gaucho"}</script></body></html>`, "https://linktr.ee/x") as Anything;
    expect(hub.links.whatsapp).toEqual(["573001234567"]);
    expect(hub.links.instagram).toEqual(["casa_gaucho"]);
  });
});

describe("readPage", () => {
  it("reads a page", async () => {
    network({ "https://gaucho.co": { body: page("", "<h1>Hola</h1>") } });
    const { page: read } = (await readPage("https://gaucho.co/")) as Anything;
    expect(read.title).toBe("Gaucho | Medellín");
  });

  it("reports an HTTP error instead of throwing", async () => {
    network({ "https://gaucho.co": { status: 404 } });
    expect(await readPage("https://gaucho.co/")).toEqual({ page: null, blocked: "HTTP 404" });
  });

  it("reports a network failure instead of throwing", async () => {
    network({ "https://gaucho.co": new Error("getaddrinfo ENOTFOUND") });
    expect(await readPage("https://gaucho.co/")).toEqual({ page: null, blocked: "getaddrinfo ENOTFOUND" });
  });
});

describe("scrapeSite", () => {
  it("reads the home page plus the contact and menu pages it links to, merged", async () => {
    network({
      "https://gaucho.co/contacto": { body: page("", `<div><a href="tel:+573001234567">Llamar</a></div><p>Lunes a viernes 12:00 - 22:00</p>`) },
      "https://gaucho.co/carta": { body: page("", `<a href="/carta.pdf">Carta</a>`) },
      "https://gaucho.co": {
        body: page(
          "",
          `<a href="/contacto">Contacto</a><a href="/carta">Carta</a><a href="/blog">Blog</a><a href="/foto.jpg">Foto</a><a href="https://other.co/contacto">Afuera</a><a href="https://wa.me/573001234567">WA</a>`,
        ),
      },
    });
    const site = (await scrapeSite("https://gaucho.co/")) as Anything;
    expect(site.pages.map((p: Anything) => p.url)).toEqual(["https://gaucho.co/", "https://gaucho.co/contacto", "https://gaucho.co/carta"]);
    expect(site.links.tel).toEqual(["+573001234567"]);
    expect(site.links.whatsapp).toEqual(["573001234567"]);
    // The "Carta" link on the home page counts as a menu link too.
    expect(site.links.menu).toEqual(["https://gaucho.co/carta", "https://gaucho.co/carta.pdf"]);
    expect(site.hoursText).toEqual(["Lunes a viernes 12:00 - 22:00"]);
  }, 15000);

  it("stops at the page limit", async () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="/contacto-${i}">Contacto ${i}</a>`).join("");
    const { calls } = network({ "https://gaucho.co": { body: page("", links) } });
    const site = (await scrapeSite("https://gaucho.co/", { maxPages: 2 })) as Anything;
    expect(site.pages).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("fails clearly when the first page cannot be read", async () => {
    network({ "https://gaucho.co": { status: 500 } });
    await expect(scrapeSite("https://gaucho.co/")).rejects.toThrow(/could not read https:\/\/gaucho.co\/ \(HTTP 500\)/);
  });
});

describe("searchOsm", () => {
  const hit = {
    name: "Gaucho",
    lat: "6.2",
    lon: "-75.57",
    osm_type: "node",
    osm_id: 42,
    display_name: "Gaucho, Medellín",
    address: { road: "Carrera 35", house_number: "8-30", town: "Medellín", state: "Antioquia", country_code: "co", postcode: "050021" },
    extratags: {
      phone: "+57 604 555 0000",
      "contact:whatsapp": "+573001234567",
      website: "https://gaucho.co",
      cuisine: "argentinian;steak_house",
      opening_hours: "Mo-Su 12:00-22:00",
      "contact:instagram": "casa_gaucho",
    },
  };

  it("asks Nominatim politely, in the restaurant's country", async () => {
    const { calls } = network({ "https://nominatim.openstreetmap.org": { json: [hit] } });
    await searchOsm({ name: "Gaucho", location: "Medellín", country: "CO" });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("q")).toBe("Gaucho, Medellín");
    expect(url.searchParams.get("countrycodes")).toBe("co");
    expect(calls[0].init?.headers["user-agent"]).toContain("cannario-research");
  });

  it("returns the match, normalised", async () => {
    network({ "https://nominatim.openstreetmap.org": { json: [{ name: "Another place", lat: "1", lon: "1" }, hit] } });
    const { place, candidates } = (await searchOsm({ name: "Gaucho", location: "Medellín" })) as Anything;
    expect(place).toMatchObject({
      source: "osm",
      name: "Gaucho",
      street: "Carrera 35 8-30",
      locality: "Medellín",
      region: "Antioquia",
      country: "CO",
      coords: { lat: 6.2, lng: -75.57 },
      phone: "+57 604 555 0000",
      whatsapp: "+573001234567",
      website: "https://gaucho.co",
      instagram: "casa_gaucho",
      cuisines: ["Argentinian", "Steak house"],
      osmUrl: "https://www.openstreetmap.org/node/42",
    });
    expect(place.hours.week[0]).toEqual([["12:00", "22:00"]]);
    expect(candidates).toHaveLength(2);
  });

  it("returns no place, and the closest candidates, when no name matches", async () => {
    network({ "https://nominatim.openstreetmap.org": { json: [{ name: "La Parrilla", display_name: "La Parrilla, Cali", lat: "1", lon: "1" }] } });
    const { place, candidates } = (await searchOsm({ name: "Gaucho", location: "" })) as Anything;
    expect(place).toBeNull();
    expect(candidates).toEqual([{ name: "La Parrilla", address: "La Parrilla, Cali" }]);
  });

  it("drops the trailing comma when there is no location", async () => {
    const { calls } = network({ "https://nominatim.openstreetmap.org": { json: [] } });
    await searchOsm({ name: "Gaucho", location: "" });
    expect(new URL(calls[0].url).searchParams.get("q")).toBe("Gaucho");
  });

  it("throws on an error status", async () => {
    network({ "https://nominatim.openstreetmap.org": { status: 429 } });
    await expect(searchOsm({ name: "Gaucho", location: "x" })).rejects.toThrow("Nominatim 429");
  });
});

describe("searchGoogle", () => {
  const place = {
    id: "abc",
    displayName: { text: "Gaucho" },
    formattedAddress: "Cra 35 # 8-30, Medellín, Antioquia, Colombia",
    addressComponents: [
      { types: ["locality"], longText: "Medellín" },
      { types: ["administrative_area_level_1"], longText: "Antioquia" },
      { types: ["country"], shortText: "CO" },
    ],
    location: { latitude: 6.2, longitude: -75.57 },
    internationalPhoneNumber: "+57 300 123 4567",
    websiteUri: "https://gaucho.co",
    priceLevel: "PRICE_LEVEL_MODERATE",
    rating: 4.6,
    userRatingCount: 210,
    types: ["italian_restaurant", "steak_house", "restaurant", "point_of_interest"],
    primaryTypeDisplayName: { text: "Steakhouse" },
    businessStatus: "OPERATIONAL",
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 12 }, close: { day: 1, hour: 22 } }] },
    photos: [{ name: "places/abc/photos/1", widthPx: 4000, heightPx: 3000, authorAttributions: [{ displayName: "Ana" }] }],
  };

  it("sends the key and the field mask as headers, never in the URL", async () => {
    const { calls } = network({ "https://places.googleapis.com/v1/places:searchText": { json: { places: [place] } } });
    await searchGoogle({ name: "Gaucho", location: "Medellín", country: "CO", key: "SECRET" });
    expect(calls[0].url).not.toContain("SECRET");
    expect(calls[0].init?.headers["x-goog-api-key"]).toBe("SECRET");
    expect(calls[0].init?.headers["x-goog-fieldmask"]).toContain("places.regularOpeningHours");
    expect(JSON.parse(calls[0].init?.body)).toEqual({ textQuery: "Gaucho Medellín", maxResultCount: 5, regionCode: "CO" });
  });

  it("returns the matching place, normalised", async () => {
    network({ "https://places.googleapis.com/v1/places:searchText": { json: { places: [place] } } });
    const { place: found } = (await searchGoogle({ name: "Gaucho", location: "Medellín", key: "k" })) as Anything;
    expect(found).toMatchObject({
      source: "google",
      name: "Gaucho",
      street: "Cra 35 # 8-30",
      locality: "Medellín",
      region: "Antioquia",
      country: "CO",
      coords: { lat: 6.2, lng: -75.57 },
      phone: "+57 300 123 4567",
      priceRange: "$$",
      rating: 4.6,
      descriptor: "Steakhouse",
      status: "OPERATIONAL",
      cuisines: ["Italian", "Steakhouse"],
    });
    expect(found.hours.week[0]).toEqual([["12:00", "22:00"]]);
    expect(found.photos).toEqual([{ name: "places/abc/photos/1", width: 4000, height: 3000, authors: ["Ana"] }]);
  });

  it("has no place and lists the candidates when no name matches", async () => {
    network({ "https://places.googleapis.com/v1/places:searchText": { json: { places: [{ ...place, displayName: { text: "La Parrilla" } }] } } });
    const result = (await searchGoogle({ name: "Gaucho", location: "x", key: "k" })) as Anything;
    expect(result.place).toBeNull();
    expect(result.candidates[0]).toMatchObject({ name: "La Parrilla" });
  });

  it("copes with no results at all", async () => {
    network({ "https://places.googleapis.com/v1/places:searchText": { json: {} } });
    expect(await searchGoogle({ name: "Gaucho", location: "x", key: "k" })).toEqual({ place: null, candidates: [] });
  });

  it("throws with the status and a trimmed body on an error", async () => {
    network({ "https://places.googleapis.com/v1/places:searchText": { status: 403, body: "API key not valid".padEnd(500, "!") } });
    await expect(searchGoogle({ name: "Gaucho", location: "x", key: "k" })).rejects.toThrow(/Google Places 403: API key not valid/);
  });
});

describe("downloadPhotos", () => {
  const photos = [1, 2, 3].map((n) => ({ name: `places/abc/photos/${n}`, width: 100 * n, height: 50, authors: [] }));

  it("saves up to `count` photos and reports them, numbered", async () => {
    network({ "https://places.googleapis.com/v1/places/abc/photos/": { body: "jpeg" } });
    const saved: string[] = [];
    const result = await downloadPhotos({ photos } as never, "k", 2, async (file: string) => void saved.push(file));
    expect(saved).toEqual(["google-01.jpg", "google-02.jpg"]);
    expect(result).toHaveLength(2);
  });

  it("skips a photo that fails and carries on", async () => {
    network({
      "https://places.googleapis.com/v1/places/abc/photos/1": { status: 500 },
      "https://places.googleapis.com/v1/places/abc/photos/2": { body: "jpeg" },
    });
    const saved: string[] = [];
    await downloadPhotos({ photos: photos.slice(0, 2) } as never, "k", 5, async (file: string) => void saved.push(file));
    expect(saved).toEqual(["google-02.jpg"]);
  });
});

describe("readInstagram", () => {
  const card = (description: string, title = "Gaucho (@casa_gaucho) • Instagram photos and videos") =>
    `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content='${description}'><meta property="og:image" content="https://cdn/ig.jpg"></head></html>`;

  it("reads the share card: counts, bio, phone and link", async () => {
    network({
      "https://www.instagram.com/casa_gaucho/": {
        body: card(`1,234 Followers, 56 Following, 789 Posts - Gaucho (@casa_gaucho) on Instagram: &quot;Parrilla en Medellín. Reservas +57 300 123 4567. linktr.ee/gaucho&quot;`),
      },
    });
    expect(await readInstagram("casa_gaucho")).toMatchObject({
      handle: "casa_gaucho",
      displayName: "Gaucho",
      followers: "1,234",
      posts: "789",
      phones: ["+57 300 123 4567"],
      links: ["https://linktr.ee/gaucho"],
      image: "https://cdn/ig.jpg",
    });
  });

  it("reports a login wall when the page has no public metadata", async () => {
    network({ "https://www.instagram.com/": { body: "<html></html>" } });
    expect(await readInstagram("x")).toMatchObject({ blocked: "login wall (no public metadata)" });
  });

  it("reports an HTTP error and a network error as 'blocked'", async () => {
    network({ "https://www.instagram.com/": { status: 429 } });
    expect(await readInstagram("x")).toMatchObject({ blocked: "HTTP 429" });
    network({ "https://www.instagram.com/": new Error("socket hang up") });
    expect(await readInstagram("x")).toMatchObject({ blocked: "socket hang up" });
  });
});

describe("readTripadvisor and readHub", () => {
  it("reads TripAdvisor's structured data when the page loads", async () => {
    const ld = { "@type": "Restaurant", name: "Gaucho", aggregateRating: { ratingValue: "4.5", reviewCount: "9" } };
    network({
      "https://www.tripadvisor.com/r": {
        body: page(`<meta name="description" content="Reviews"><script type="application/ld+json">${JSON.stringify(ld)}</script>`, ""),
      },
    });
    const result = (await readTripadvisor("https://www.tripadvisor.com/r")) as Anything;
    expect(result.jsonld.rating).toEqual({ value: 4.5, count: 9 });
    expect(result.description).toBe("Reviews");
  });

  it("says it was blocked when the page carries no data", async () => {
    // A page with fewer than 500 visible characters and no structured data is a bot wall.
    // Between the 300 characters that avoid a browser and the 500 that count as a real page.
    network({ "https://www.tripadvisor.com/r": { body: `<html><body><p>${"Please verify you are human. ".repeat(12)}</p></body></html>` } });
    expect(await readTripadvisor("https://www.tripadvisor.com/r")).toMatchObject({ blocked: expect.stringContaining("bot protection") });
  });

  it("passes on an HTTP error", async () => {
    network({ "https://www.tripadvisor.com/r": { status: 404 } });
    expect(await readTripadvisor("https://www.tripadvisor.com/r")).toEqual({ url: "https://www.tripadvisor.com/r", blocked: "HTTP 404" });
  });

  it("reads a link-in-bio hub's links", async () => {
    network({
      "https://linktr.ee/gaucho": { body: page("", `<a href="https://wa.me/573001234567">WhatsApp</a><a href="https://gaucho.co/carta.pdf">Carta</a>`) },
    });
    const hub = (await readHub("https://linktr.ee/gaucho")) as Anything;
    expect(hub.links.whatsapp).toEqual(["573001234567"]);
    expect(hub.links.menu).toEqual(["https://gaucho.co/carta.pdf"]);
    expect(hub.anchors.some((a: Anything) => a.text === "WhatsApp")).toBe(true);
  });

  it("reports a hub it could not read", async () => {
    network({ "https://linktr.ee/gaucho": { status: 500 } });
    expect(await readHub("https://linktr.ee/gaucho")).toEqual({ url: "https://linktr.ee/gaucho", blocked: "HTTP 500" });
  });
});
