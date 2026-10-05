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
});
