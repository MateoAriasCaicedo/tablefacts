/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs modules without type declarations
import { research } from "../src/research/index.mjs";

// End to end through research(): the restaurant's website is a real local server; Google, OpenStreetMap,
// Instagram and TripAdvisor are answered by a stubbed fetch, so nothing leaves the machine.

const realFetch = globalThis.fetch;
let server: Server;
let base = "";
const scratch: string[] = [];

const PAGE = `<!doctype html><html lang="en"><head><title>La Casa</title>
<meta name="description" content="Wood-fired food in Medellin">
<script type="application/ld+json">{"@type":"Restaurant","name":"La Casa","telephone":"+57 300 111 2222","servesCuisine":"Colombian","address":{"streetAddress":"Calle 10 # 5-5","addressLocality":"Medellin","addressCountry":"CO"},"sameAs":["https://www.tripadvisor.com/Restaurant_Review-g1-d2-Reviews-La_Casa.html"]}</script>
</head><body><h1>La Casa</h1><a href="https://www.instagram.com/lacasa_mde/">insta</a>
<img src="/big.jpg" width="900"><p>${"Open every day. ".repeat(40)}</p></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/big.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.alloc(20000, 1));
    } else if (req.url === "/" || req.url === "/menu") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    } else {
      res.writeHead(404);
      res.end("no");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));
afterEach(() => {
  vi.unstubAllGlobals();
  scratch.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

function stubNetwork(handler: (url: string, init?: any) => Response | undefined) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    calls.push(url);
    if (url.startsWith(base)) return realFetch(input, init);
    return handler(url, init) ?? new Response("blocked", { status: 403 });
  });
  return calls;
}
const out = () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-research-"));
  scratch.push(dir);
  return dir;
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("research()", { timeout: 30000 }, () => {
  it("rejects a missing name", async () => {
    await expect(research({})).rejects.toMatchObject({ code: "EUSAGE" });
    await expect(research({ name: "   " })).rejects.toMatchObject({ code: "EUSAGE" });
  });

  it("builds a profile from the website alone and writes the three files", async () => {
    const calls = stubNetwork(() => undefined);
    const dir = out();
    const lines: string[] = [];
    const result = await research({ name: "La Casa", location: "Medellin, Colombia", website: base, google: false, out: dir, log: (m: string) => lines.push(m) });
    expect(Object.keys(result.files).sort()).toEqual(["profile", "report", "setupAnswers"]);
    for (const file of Object.values(result.files) as string[]) expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(result.files.profile, "utf8"));
    expect(saved.fields.phone?.value ?? JSON.stringify(saved.fields)).toContain("300");
    expect(result.notes.join("\n")).toMatch(/Google Places: skipped/);
    expect(result.notes.join("\n")).toMatch(/Website: read/);
    expect(lines[0]).toBe('Researching "La Casa" in Medellin, Colombia');
    expect(calls.some((u) => u.includes("places.googleapis.com"))).toBe(false);
  });

  it("uses Google Places when a key is given and reports a match", async () => {
    const calls = stubNetwork((url) => {
      if (url.includes("places.googleapis.com")) {
        return json({ places: [{ id: "g1", displayName: { text: "La Casa" }, formattedAddress: "Calle 10 # 5-5, Medellin, Colombia", websiteUri: base, nationalPhoneNumber: "300 111 2222", location: { latitude: 6.2, longitude: -75.5 } }] });
      }
      if (url.includes("nominatim")) return json([]);
    });
    const result = await research({ name: "La Casa", location: "Medellin", googleKey: "k", out: out() });
    expect(calls.some((u) => u.includes("places.googleapis.com"))).toBe(true);
    // Google already gave a website, so the key-free web search is not run.
    expect(calls.some((u) => u.includes("duckduckgo"))).toBe(false);
    expect(result.notes.join("\n")).toMatch(/Google Places: matched "La Casa"/);
    expect(result.notes.join("\n")).toMatch(/OpenStreetMap: no match/);
    // the website came from Google, so it was read without --website
    expect(result.notes.join("\n")).toMatch(/Website: read/);
  });

  it("turns a failing source into a note instead of failing the run", async () => {
    stubNetwork(() => new Response("boom", { status: 500 }));
    const result = await research({ name: "La Casa", googleKey: "k", website: base, out: out() });
    expect(result.notes.join("\n")).toMatch(/Google Places: failed \(Google Places 500/);
    expect(result.notes.join("\n")).toMatch(/OpenStreetMap: failed/);
    expect(existsSync(result.files.profile)).toBe(true);
  });

  it("downloads website photos when photos > 0 and skips tiny ones", async () => {
    stubNetwork(() => undefined);
    const dir = out();
    const result = await research({ name: "La Casa", website: base, google: false, photos: 2, out: dir });
    expect(result.photos.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, "photos", result.photos[0].file))).toBe(true);
  });

  it("notes the absence of a website, instagram and tripadvisor", async () => {
    stubNetwork(() => json([]));
    const result = await research({ name: "Nowhere Bistro", google: false, out: out() });
    const text = result.notes.join("\n");
    expect(text).toMatch(/Website: none found/);
    expect(text).toMatch(/Instagram: no handle found/);
    expect(text).toMatch(/TripAdvisor: no link found/);
  });

  it("defaults the output folder under the project's .tablefacts directory", async () => {
    stubNetwork(() => json([]));
    const project = out();
    const result = await research({ name: "La Casa Verde", google: false, projectDir: project });
    expect(result.outDir).toContain("la-casa-verde");
    expect(result.outDir.startsWith(project)).toBe(true);
  });

  it("falls back to a key-free web search when Google and OpenStreetMap find nothing", async () => {
    const ddg = `<html><body><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(`${base}/`)}">La Casa</a></body></html>`;
    stubNetwork((url) => {
      if (url.includes("duckduckgo.com")) return new Response(ddg, { status: 200, headers: { "content-type": "text/html" } });
      if (url.includes("nominatim")) return json([]);
    });
    const result = await research({ name: "La Casa", location: "Medellin", google: false, out: out() });
    const text = result.notes.join("\n");
    expect(text).toMatch(/Web search: 1 result/);
    expect(text).toMatch(/Website: read/);
    expect(text).toMatch(/found by web search/);
  });

  it("warns when Google returns several places with the same name", async () => {
    stubNetwork((url) => {
      if (url.includes("places.googleapis.com")) {
        return json({ places: [
          { id: "1", displayName: { text: "Makibar" }, formattedAddress: "Cra 1, Medellin", location: { latitude: 6.2, longitude: -75.5 }, websiteUri: `${base}/` },
          { id: "2", displayName: { text: "Makibar" }, formattedAddress: "Cra 2, Bogota", location: { latitude: 4.6, longitude: -74.1 } },
        ] });
      }
      if (url.includes("nominatim")) return json([]);
    });
    const result = await research({ name: "Makibar", location: "Colombia", googleKey: "k", out: out() });
    expect(result.profile.warnings.join("\n")).toMatch(/looks like a chain/);
  });

  it("does not warn about a chain for a single Google place", async () => {
    stubNetwork((url) => {
      if (url.includes("places.googleapis.com")) {
        return json({ places: [{ id: "1", displayName: { text: "Makibar" }, formattedAddress: "Cra 1, Medellin", location: { latitude: 6.2, longitude: -75.5 }, websiteUri: `${base}/` }] });
      }
      if (url.includes("nominatim")) return json([]);
    });
    const result = await research({ name: "Makibar", location: "Colombia", googleKey: "k", out: out() });
    expect(result.profile.warnings.join("\n")).not.toMatch(/chain/);
  });

  it("reports an Instagram bio that came from a search snippet", async () => {
    const ddg = `<html><body><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://www.instagram.com/makibar.col/")}">Makibar</a><a class="result__snippet">1,234 Followers, 56 Following, 789 Posts - Makibar (@makibar.col) on Instagram: "Sushi en Medellín."</a></body></html>`;
    stubNetwork((url) => {
      if (url.includes("duckduckgo.com")) return new Response(ddg, { status: 200, headers: { "content-type": "text/html" } });
      if (url.includes("nominatim")) return json([]);
      if (url.includes("instagram.com")) return new Response("no", { status: 404 });
    });
    const result = await research({ name: "Makibar", location: "Medellin", google: false, out: out() });
    expect(readFileSync(result.files.report, "utf8")).toContain("Bio from a search snippet");
  });

  it("keeps a blocked, user-supplied TripAdvisor link and says so at the top of the report", async () => {
    const taBody = `<html><body><p>${"Please verify you are human. ".repeat(12)}</p></body></html>`;
    stubNetwork((url) => {
      if (url.includes("tripadvisor")) return new Response(taBody, { status: 200, headers: { "content-type": "text/html" } });
      if (url.includes("nominatim")) return json([]);
    });
    const result = await research({
      name: "Maki Bar", location: "Medellin", google: false,
      tripadvisor: "https://www.tripadvisor.co/Restaurant_Review-g1-d2-Reviews-Maki_Bar_Medellin-Medellin.html", out: out(),
    });
    expect(readFileSync(result.files.report, "utf8")).toContain("Kept for a manual read");
    expect(result.notes.join("\n")).toMatch(/TripAdvisor .*blocked/);
    // The URL slug is surfaced as a hint in the source note, not as a field.
    expect(result.notes.join("\n")).toMatch(/URL suggests "Maki Bar Medellin"/);
  });

  it("follows a link-in-bio hub a web search found", async () => {
    const reply = (url: string, body: string) => ({ ok: true, status: 200, url, headers: { get: () => "text/html" }, text: async () => body, body: null });
    const ddg = `<html><body><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://linktr.ee/makibar")}">Makibar links</a></body></html>`;
    const hubPage = `<html lang="es"><body><a href="https://wa.me/573001234567">WhatsApp</a>${"x".repeat(320)}</body></html>`;
    stubNetwork((url) => {
      if (url.includes("duckduckgo.com")) return reply(url, ddg);
      if (url.includes("nominatim")) return json([]);
      if (url.includes("linktr.ee")) return reply(url, hubPage);
    });
    const result = await research({ name: "Makibar", location: "Medellin", google: false, out: out() });
    expect(result.notes.join("\n")).toMatch(/Link-in-bio: read https:\/\/linktr\.ee\/makibar/);
  });

  it("labels a TripAdvisor link found on the restaurant's own site as 'website'", async () => {
    const taBody = `<html><body><p>${"Please verify you are human. ".repeat(12)}</p></body></html>`;
    stubNetwork((url) => {
      if (url.includes("tripadvisor")) return new Response(taBody, { status: 200, headers: { "content-type": "text/html" } });
      if (url.includes("nominatim")) return json([]);
    });
    // The fixture site's JSON-LD sameAs points at TripAdvisor; no --tripadvisor was given.
    const result = await research({ name: "La Casa", location: "Medellin", google: false, website: base, out: out() });
    expect(result.profile.fields.tripadvisor).toMatchObject({ source: "website" });
  });

  it("does not write latest.json when an explicit output folder is used", async () => {
    stubNetwork(() => json([]));
    const parent = out();
    const dir = join(parent, "run-1");
    const result = await research({ name: "Nowhere Bistro", google: false, out: dir });
    expect(result.outDir).toBe(dir);
    expect(existsSync(join(parent, "latest.json"))).toBe(false);
  });

  it("points at the newest run when a similar name was researched before", async () => {
    stubNetwork(() => json([]));
    const project = out();
    await research({ name: "Makibar", location: "Medellin", google: false, projectDir: project });
    const second = await research({ name: "Maki Bar", location: "Medellin", google: false, projectDir: project });
    expect(second.notes.join("\n")).toMatch(/similar name/);
    const latest = JSON.parse(readFileSync(join(project, ".tablefacts", "research", "latest.json"), "utf8"));
    expect(latest.slug).toBe("maki-bar");
  });
});
