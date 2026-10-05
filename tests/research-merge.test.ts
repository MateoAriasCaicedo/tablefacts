import { describe, expect, it } from "vitest";
import { buildProfile } from "../src/research/lib/merge.mjs";
import { fieldSummary, renderReport, setupAnswers, summaryLines } from "../src/research/lib/report.mjs";

/* The sources are loosely typed on purpose: each test passes only what it
   needs, as the real run does when a source finds nothing. */
type Anything = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const query = { name: "Gaucho", location: "Medellín", slug: "gaucho" };
const week = Array.from({ length: 7 }, () => [["12:00", "22:00"]]);
const links = (over: Anything = {}) => ({
  tel: [], mail: [], whatsapp: [], reserve: [], menu: [], delivery: [], maps: [], waze: [],
  facebook: [], tiktok: [], tripadvisor: [], hubs: [], instagram: [], ...over,
});
const google = (over: Anything = {}): Anything => ({
  name: "Gaucho", street: "Cra 35 # 8-30", locality: "Medellín", region: "Antioquia", country: "CO",
  coords: { lat: 6.2, lng: -75.57 }, phone: "+57 300 123 4567", status: "OPERATIONAL", cuisines: ["Steakhouse"], ...over,
});
const site = (over: Anything = {}): Anything => ({
  meta: { siteName: "", description: "", themeColor: "" }, links: links(), lang: "", ...over,
});
const build = (input: Anything) => buildProfile({ query, ...input } as never) as Anything;

describe("buildProfile fields", () => {
  it("takes a lone source at medium confidence", () => {
    const { fields } = build({ google: google() });
    expect(fields.name).toEqual({ value: "Gaucho", source: "google", confidence: "medium" });
    expect(fields.street.value).toBe("Cra 35 # 8-30");
  });

  it("raises confidence when two sources agree, and names both", () => {
    const { fields } = build({
      google: google(),
      site: site({ jsonld: { name: "Restaurante El Gaucho", address: { street: "", locality: "", region: "", country: "" } } }),
    });
    expect(fields.name).toMatchObject({ value: "Gaucho", source: "google + website", confidence: "high" });
  });

  it("keeps what the other sources said instead", () => {
    const { fields } = build({
      google: google({ phone: "+57 300 123 4567" }),
      osm: { phone: "+57 604 555 0000" },
    });
    expect(fields.phone.value).toBe("+57 300 123 4567");
    expect(fields.phone.alternatives).toEqual([{ value: "+57 604 555 0000", source: "osm" }]);
  });

  it("treats one phone number written two ways as agreement, not a conflict", () => {
    const { fields } = build({ google: google({ phone: "+57 300 123 4567" }), osm: { phone: "300-123-4567" } });
    expect(fields.phone.confidence).toBe("high");
    expect(fields.phone.alternatives).toBeUndefined();
  });

  it("lets the person's own flags win over everything", () => {
    const { fields } = build({
      query: { ...query, country: "mx", instagram: "https://www.instagram.com/@casa_gaucho/?hl=es" },
      google: google(),
    });
    expect(fields.country).toMatchObject({ value: "MX", source: "you" });
    expect(fields.country.alternatives).toEqual([{ value: "CO", source: "google" }]);
    expect(fields.instagram.value).toBe("casa_gaucho");
  });

  it("strips tracking parameters from a website URL", () => {
    const { fields } = build({ google: google({ website: "https://gaucho.co/?utm_source=google&fbclid=1&lang=es" }) });
    expect(fields.website.value).toBe("https://gaucho.co/?lang=es");
  });

  it("counts two map points within 150 m as the same place", () => {
    const { fields } = build({ google: google({ coords: { lat: 6.2, lng: -75.57 } }), osm: { coords: { lat: 6.2005, lng: -75.57 } } });
    expect(fields.coordinates.confidence).toBe("high");
  });

  it("marks a guess as low confidence", () => {
    const { fields } = build({ google: google() });
    expect(fields.menuLocale).toMatchObject({ confidence: "low", value: "es", source: "country" });
  });

  it("skips fields no source had", () => {
    const { fields } = build({ google: google() });
    expect(fields.email).toBeNull();
    expect(fields.tiktok).toBeNull();
  });

  it("ignores an email that is an error-tracking address", () => {
    const { fields } = build({ site: site({ links: links({ mail: ["abc@sentry.io", "hola@gaucho.co"] }) }) });
    expect(fields.email.value).toBe("hola@gaucho.co");
  });

  it("merges cuisines from every source without repeating one", () => {
    const { fields } = build({ google: google({ cuisines: ["Steakhouse", "Latin"] }), osm: { cuisines: ["Latin", "Grill"] } });
    expect(fields.cuisines.value).toEqual(["Steakhouse", "Latin", "Grill"]);
    expect(fields.cuisines).toMatchObject({ source: "google + osm", confidence: "high" });
  });

  it("collects Instagram handles by how often the site links them", () => {
    const { fields } = build({ site: site({ links: links({ instagram: ["casa_gaucho", "other"] }) }) });
    expect(fields.instagram).toMatchObject({ value: "casa_gaucho", source: "website" });
  });
});

describe("buildProfile web search", () => {
  const search = {
    website: "https://makibar.co/?utm_source=x", instagram: "makibar.col", tripadvisor: "https://www.tripadvisor.co/x",
    facebook: "https://facebook.com/makibar", tiktok: "https://tiktok.com/@makibar", mapsUrl: "https://maps.app.goo.gl/abc",
  };

  it("uses the links a web search found when nothing else did", () => {
    const { fields } = build({ search });
    expect(fields.website).toMatchObject({ value: "https://makibar.co", source: "search" });
    expect(fields.instagram).toMatchObject({ value: "makibar.col", source: "search" });
    expect(fields.tripadvisor).toMatchObject({ value: "https://www.tripadvisor.co/x", source: "search" });
    expect(fields.facebook).toMatchObject({ source: "search" });
    expect(fields.tiktok).toMatchObject({ source: "search" });
    expect(fields.mapsUrl).toMatchObject({ source: "search" });
  });

  it("keeps a TripAdvisor URL slug name only as a low-confidence guess", () => {
    const { fields } = build({ tripadvisor: { slug: { name: "Maki Bar Medellin", location: "Medellin Antioquia Department" } } });
    expect(fields.name).toMatchObject({ value: "Maki Bar Medellin", source: "tripadvisor (URL)", confidence: "low" });
    expect(fields.locality).toBeNull();
  });

  it("adds the hub links a web search found", () => {
    const { links: out } = build({ search: { hubs: ["https://linktr.ee/makibar"] } });
    expect(out.hubs).toEqual(["https://linktr.ee/makibar"]);
  });

  it("prefers Google and the website over a web-search link", () => {
    const { fields } = build({ google: google({ website: "https://gaucho.co" }), search: { website: "https://other.example" } });
    expect(fields.website).toMatchObject({ value: "https://gaucho.co", source: "google" });
  });

  it("lets a user-supplied TripAdvisor link win over a search one", () => {
    const { fields } = build({ query: { ...query, tripadvisor: "https://www.tripadvisor.com/mine" }, search: { tripadvisor: "https://www.tripadvisor.com/search" } });
    expect(fields.tripadvisor).toMatchObject({ value: "https://www.tripadvisor.com/mine", source: "you" });
  });

  it("carries the Instagram surface and partial flag into the profile", () => {
    const { social } = build({ instagram: { handle: "x", partial: true, surface: "search snippet", followers: "", posts: "" } });
    expect(social.instagram).toMatchObject({ partial: true, surface: "search snippet" });
  });
});

describe("fieldSummary", () => {
  it("separates discovered, echoed and guessed fields", () => {
    const profile = build({ query: { ...query, country: "CO", instagram: "casa_gaucho" }, google: google({ country: "" }) });
    const summary = fieldSummary(profile);
    expect(summary.discovered).toEqual(expect.arrayContaining(["name", "street"]));
    expect(summary.echoed).toEqual(expect.arrayContaining(["country", "instagram"]));
    expect(summary.guessed).toEqual(expect.arrayContaining(["menuLocale", "whatsapp"]));
    expect(summary.discovered).not.toContain("menuLocale");
  });

  it("does not count a field with no source as echoed from your input", () => {
    expect(fieldSummary({ fields: { weird: { value: "x", source: "", confidence: "medium" } } } as never).echoed).toEqual([]);
  });

  it("counts a value the user gave that a source confirmed as discovered, not echoed", () => {
    const profile = build({ query: { ...query, country: "CO" }, google: google({ country: "CO" }) });
    const summary = fieldSummary(profile);
    expect(summary.discovered).toContain("country");
    expect(summary.echoed).not.toContain("country");
  });
});

describe("summaryLines", () => {
  it("reports discovered, echoed and guessed fields in the CLI wording", () => {
    const profile = build({ query: { ...query, country: "CO" }, google: google({ country: "MX", website: "https://gaucho.co" }) });
    const lines = summaryLines(profile);
    expect(lines[0]).toMatch(/^Found \d+ fact\(s\) from sources:/);
    const text = lines.join("\n");
    expect(text).toMatch(/Echoed \d+ from your input: country/);
    expect(text).toMatch(/Not counted \(low-confidence guess\): .*menuLocale/);
  });

  it("says none instead of an empty list, and omits lines that do not apply", () => {
    const lines = summaryLines(build({}));
    expect(lines).toEqual(["Found 0 fact(s) from sources: none"]);
  });
});

describe("buildProfile warnings", () => {
  it("warns about a place that is not operational", () => {
    expect(build({ google: google({ status: "CLOSED_PERMANENTLY" }) }).warnings.join()).toContain("CLOSED_PERMANENTLY");
  });

  it("warns when Google and OpenStreetMap disagree by more than 500 m", () => {
    const { warnings } = build({ google: google(), osm: { coords: { lat: 6.3, lng: -75.57 } } });
    expect(warnings.join()).toContain("500 m");
  });

  it("stays quiet when they agree", () => {
    expect(build({ google: google(), osm: { coords: { lat: 6.2001, lng: -75.57 } } }).warnings).toEqual([]);
  });

  it("warns when only the website and social pages were found", () => {
    expect(build({}).warnings.join()).toContain("No Google or OpenStreetMap match");
  });
});

describe("buildProfile whatsapp", () => {
  it("uses an explicit WhatsApp link, written the way the phone is", () => {
    const { fields } = build({
      google: google({ phone: "+57 300 123 4567" }),
      site: site({ links: links({ whatsapp: ["573001234567"] }) }),
    });
    expect(fields.whatsapp).toEqual({
      value: "573001234567",
      display: "+57 300 123 4567",
      source: "website",
      confidence: "medium",
    });
  });

  it("falls back to the phone as a guess, and says so", () => {
    const { fields } = build({ google: google() });
    expect(fields.whatsapp).toMatchObject({ value: "573001234567", confidence: "low", display: "+57 300 123 4567" });
    expect(fields.whatsapp.note).toContain("Confirm");
  });

  it("is absent with neither", () => {
    expect(build({}).fields.whatsapp).toBeUndefined();
  });

  it("credits a link-in-bio hub when that is where the link came from", () => {
    const { fields } = build({ hub: { links: links({ whatsapp: ["573001234567"] }) } });
    expect(fields.whatsapp.source).toBe("link-in-bio");
  });
});

describe("buildProfile menu language", () => {
  it("follows the website's language first", () => {
    expect(build({ site: site({ lang: "en-US" }), google: google() }).fields.menuLocale).toMatchObject({ value: "en", source: "website language" });
  });
  it("falls back to the country: Spanish-speaking or not", () => {
    expect(build({ google: google({ country: "MX" }) }).fields.menuLocale.value).toBe("es");
    expect(build({ google: google({ country: "US" }) }).fields.menuLocale.value).toBe("en");
  });
  it("makes no guess without a country or a language", () => {
    expect(build({}).fields.menuLocale).toBeUndefined();
  });
});

describe("buildProfile hours", () => {
  it("is null with no structured hours", () => {
    expect(build({ google: google() }).hours).toBeNull();
  });

  it("prefers the restaurant's own markup, and flags a source that disagrees", () => {
    const other = week.map(() => [["10:00", "18:00"]]);
    const { hours } = build({
      google: google({ hours: { week: other } }),
      site: site({ jsonld: { address: { country: "" }, hours: { week } } }),
    });
    expect(hours.source).toBe("website");
    expect(hours.confidence).toBe("medium");
    expect(hours.conflicts).toEqual([{ source: "google", rows: [{ label: "Every day", value: "10:00 to 18:00" }] }]);
    expect(hours.rows.es[0]).toEqual({ label: "Todos los días", value: "12:00 a 22:00" });
  });

  it("is high confidence when two sources give the same week", () => {
    const { hours } = build({ google: google({ hours: { week } }), osm: { hours: { week } } });
    expect(hours.confidence).toBe("high");
    expect(hours.conflicts).toEqual([]);
  });
});

describe("buildProfile links and ratings", () => {
  it("lists a hub from the site and from Instagram's bio, once", () => {
    const { links: out } = build({
      site: site({ links: links({ hubs: ["https://linktr.ee/gaucho"] }) }),
      instagram: { links: ["https://linktr.ee/gaucho", "https://gaucho.co"] },
    });
    expect(out.hubs).toEqual(["https://linktr.ee/gaucho"]);
  });

  it("gathers ratings from each source that has one", () => {
    const { ratings } = build({ google: google({ rating: 4.5, ratingCount: 120 }) });
    expect(ratings).toEqual([{ source: "google", value: 4.5, count: 120 }]);
  });
});

describe("renderReport", () => {
  const profile = build({ google: google({ website: "https://gaucho.co" }), osm: { phone: "+57 604 555 0000" } });
  const report: string = renderReport(profile as never, { notes: ["Google Places: matched"], photos: [] });

  it("opens with the research subject and a warning that nothing is confirmed", () => {
    expect(report.startsWith("# Research: Gaucho, Medellín")).toBe(true);
    expect(report).toContain("**unconfirmed**");
  });

  it("has a facts table with a row per item, marking what was not found", () => {
    expect(report).toContain("| Street address | Cra 35 # 8-30 | google | medium |");
    expect(report).toContain("| TikTok | _not found_ |");
  });

  it("lists where sources disagree", () => {
    expect(report).toContain("## Sources disagree");
    expect(report).toContain("**phone**");
  });

  it("explains a WhatsApp guess", () => {
    expect(report).toContain("> whatsapp: Guess");
  });

  it("says when there are no structured hours", () => {
    expect(report).toContain("No structured hours found.");
  });

  it("prints hours ready to paste when there are some", () => {
    const withHours = renderReport(build({ google: google({ hours: { week } }) }) as never, { notes: [], photos: [] });
    expect(withHours).toContain('{ label: "Todos los días", value: "12:00 a 22:00" },');
    expect(withHours).toContain('{ label: "Every day", value: "12:00 to 22:00" },');
  });

  it("escapes a pipe so a value cannot break the table", () => {
    const piped = renderReport(build({ google: google({ name: "Fish | Chips" }) }) as never, { notes: [], photos: [] });
    expect(piped).toContain("Fish \\| Chips");
  });

  it("points at the Cluvi importer for a Cluvi menu and at the PDF reader for a PDF", () => {
    const cluvi = renderReport(build({ site: site({ links: links({ menu: ["https://x.cluvi.co/menu"] }) }) }) as never, { notes: [], photos: [] });
    expect(cluvi).toContain("tablefacts menu cluvi");
    const pdf = renderReport(build({ site: site({ links: links({ menu: ["https://x.co/carta.pdf"] }) }) }) as never, { notes: [], photos: [] });
    expect(pdf).toContain("tablefacts menu raw");
  });

  it("asks the client for what is missing, with the best next question first", () => {
    const empty = renderReport(build({}) as never, { notes: [], photos: [] });
    expect(empty).toContain("- Street address");
    expect(empty).toContain("- Instagram");
    expect(empty).toContain("- **Best next question:**");
    expect(empty).toContain("Google Maps link");
    expect(report).toContain("- Opening hours incl. holidays");
  });

  it("states a kept, blocked link at the top of the report", () => {
    const withKept = renderReport(profile as never, { notes: [], photos: [], kept: [{ label: "TripAdvisor", url: "https://ta/x", reason: "bot protection" }] });
    expect(withKept).toContain("Kept for a manual read");
    expect(withKept.indexOf("Kept for a manual read")).toBeLessThan(withKept.indexOf("## Facts"));
  });

  it("marks a low-confidence guess as a guess, not a fact", () => {
    const guessed = renderReport(build({ google: google() }) as never, { notes: [], photos: [] });
    expect(guessed).toContain("| Menu language | es | country | low (guess) |");
  });

  it("says a snippet-sourced Instagram bio, separating counts and note with a space", () => {
    const profile = build({ instagram: { handle: "makibar", followers: "1,200", posts: "789", partial: true, surface: "search snippet" } });
    const r = renderReport(profile as never, { notes: [], photos: [] });
    expect(r).toContain("Instagram @makibar: 1,200 followers, 789 posts. Bio from a search snippet");
  });

  it("flattens web text so it cannot forge report structure", () => {
    const profile = build({ site: site({ meta: { siteName: "", description: "a\n\n## Injected\n`code`", themeColor: "" } }) });
    const r = renderReport(profile as never, { notes: [], photos: [] });
    expect(r).not.toContain("\n## Injected");
    expect(r).not.toContain("`code`");
  });

  it("asks for a Google Maps link when the website is known but the map point is not", () => {
    const r = renderReport(build({ google: google({ coords: null, website: "https://gaucho.co" }) }) as never, { notes: [], photos: [] });
    expect(r).toContain("A Google Maps link would pin the exact location.");
  });

  it("asks for the WhatsApp number when the rest is known", () => {
    const r = renderReport(build({ google: google({ phone: "", website: "https://gaucho.co" }) }) as never, { notes: [], photos: [] });
    expect(r).toContain("Ask for the WhatsApp number");
  });

  it("warns that downloaded photos are reference, not assets", () => {
    const withPhotos = renderReport(profile as never, { notes: [], photos: [{ file: "a.jpg" }] });
    expect(withPhotos).toContain("They are reference, not assets");
  });

  it("ends with the command that applies the answers", () => {
    expect(report).toContain("npm run setup < .tablefacts/research/gaucho/setup-answers.txt");
  });
});

describe("setupAnswers", () => {
  it("writes one line per prompt of setup.mjs, in its order", () => {
    const profile = build({
      query: { ...query, instagram: "casa_gaucho" },
      google: google({ phone: "+57 300 123 4567", website: "https://gaucho.co" }),
      site: site({ links: links({ reserve: ["https://opentable.com/gaucho"], whatsapp: ["573001234567"] }) }),
    });
    const lines = (setupAnswers(profile as never) as string).split("\n");
    expect(lines.slice(0, 12)).toEqual([
      "Gaucho", // name
      "", // production URL: the new domain, never the current website
      "https://opentable.com/gaucho", // reserve URL
      "+57 300 123 4567", // WhatsApp display
      "@casa_gaucho",
      "Cra 35 # 8-30",
      "Medellín",
      "Antioquia",
      "CO",
      "6.2",
      "-75.57",
      "Steakhouse",
    ]);
    expect(lines[12]).toBe("");
  });

  it("leaves a blank line for what was not found, which keeps the template's value", () => {
    const lines = (setupAnswers(build({}) as never) as string).split("\n");
    expect(lines.slice(0, 12).every((line) => line === "")).toBe(true);
  });

  it("leaves a low-confidence guess out, so setup keeps the placeholder", () => {
    // The phone number is only a guess at WhatsApp; it must not be written in as a fact.
    const profile = build({ google: google({ phone: "+57 300 123 4567" }) });
    expect(profile.fields.whatsapp).toMatchObject({ confidence: "low" });
    const lines = (setupAnswers(profile as never) as string).split("\n");
    expect(lines[3]).toBe("");
  });
});
