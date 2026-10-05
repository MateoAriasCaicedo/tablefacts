/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs modules without type declarations
import { fetchImageMenu, importImageMenu, listMenuImages } from "../src/menu/raw/import.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { cdpUp, ensureEdge } from "../src/lib/edge.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { loadPlaywright } from "../src/lib/playwright.mjs";

// The image-menu pipeline end to end: a local server plays the restaurant's page and its pictures, a stubbed
// fetch plays the vision API, and the cache and importer are real.

const realFetch = globalThis.fetch;
let server: Server;
let base = "";
let apiCalls = 0;
const dirs: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/menu") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<img src="/logo.png" width="80"><img src="/p1.png" width="900" alt="one"><img data-src="/p2.png" src="data:image/gif;base64,AAAA" width="900" alt="two">`);
    } else if (req.url === "/empty") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<p>no pictures</p>");
    } else if (req.url?.endsWith(".png")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(png);
    } else if (req.url === "/json/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
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
  apiCalls = 0;
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const project = () => {
  const d = mkdtempSync(join(tmpdir(), "tf-img-"));
  dirs.push(d);
  return d;
};
const anthropic = (sections: unknown[], status = 200) => {
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.startsWith(base)) return realFetch(input, init);
    apiCalls++;
    if (status !== 200) return new Response("overloaded", { status });
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_menu_page", input: { sections, notes: [] } }] }), { status: 200 });
  });
};
const page = (title: string, price: string) => [{ title, group: "food", items: [{ name: "Pan de Bono", description: "queso", prices: [{ text: price, label: null }] }] }];

describe("image menu pipeline", () => {
  it("lists the large pictures of a page, numbered, skipping logos and placeholders", async () => {
    const pages = await listMenuImages({ urls: [`${base}/menu`] });
    expect(pages.map((p: any) => [p.number, p.url.replace(base, "")])).toEqual([[1, "/p1.png"], [2, "/p2.png"]]);
  });

  it("--only selects pages, by list and by range", async () => {
    expect((await listMenuImages({ urls: [`${base}/menu`], only: "2" })).map((p: any) => p.number)).toEqual([2]);
    expect((await listMenuImages({ urls: [`${base}/menu`], only: [1, 2] })).length).toBe(2);
    expect((await listMenuImages({ urls: [`${base}/menu`], only: "1-2" })).length).toBe(2);
  });

  it("rejects a bad selection, a page with no pictures and a non-URL", async () => {
    await expect(listMenuImages({ urls: [`${base}/menu`], only: "abc" })).rejects.toMatchObject({ code: "EUSAGE" });
    await expect(listMenuImages({ urls: [`${base}/menu`], only: "9" })).rejects.toMatchObject({ code: "EUSAGE" });
    await expect(listMenuImages({ urls: [`${base}/empty`] })).rejects.toMatchObject({ code: "EFAILED" });
    await expect(listMenuImages({ urls: ["not a url"] })).rejects.toMatchObject({ code: "EUSAGE" });
    await expect(listMenuImages({ urls: [], config: { url: "" } })).rejects.toMatchObject({ code: "ECONFIG" });
  });

  it("reads each page once, normalizes the prices and caches the transcriptions", async () => {
    const projectDir = project();
    anthropic(page("entradas", "$10.000"));
    const first = await fetchImageMenu({ urls: [`${base}/menu`], apiKey: "k", projectDir });
    expect(apiCalls).toBe(2);
    expect(first.menu[0].sections[0].products[0]).toMatchObject({ name: "Pan de Bono", price: 10000, currency: "COP" });
    expect(first.title).toMatch(/2 pages .*2 read with Anthropic/);
    expect(first.notes[0]).toMatch(/Prices were read from pictures/);

    const second = await fetchImageMenu({ urls: [`${base}/menu`], apiKey: "k", projectDir });
    expect(apiCalls).toBe(2); // served from the saved transcriptions
    expect(second.title).toMatch(/0 read .*2 from the saved/);

    await fetchImageMenu({ urls: [`${base}/menu`], apiKey: "k", projectDir, refresh: true });
    expect(apiCalls).toBe(4);
  });

  it("imports through importImageMenu as a dry run with no database", async () => {
    anthropic(page("entradas", "$10.000"));
    const result = await importImageMenu({ urls: [`${base}/menu`], only: "1", apiKey: "k", projectDir: project(), dryRun: true, databaseUrl: "" });
    expect(result.dryRun).toBe(true);
    expect(result.written).toBe(false);
    expect(result.totals.products).toBe(1);
  });

  it("an unknown provider is a config error before anything is downloaded", async () => {
    await expect(fetchImageMenu({ urls: [`${base}/menu`], provider: "nope" })).rejects.toMatchObject({ code: "ECONFIG" });
  });

  it("a missing API key is a config error naming the variable", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(fetchImageMenu({ urls: [`${base}/menu`], projectDir: project() })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("a rejected key is not retried", async () => {
    anthropic([], 401);
    await expect(fetchImageMenu({ urls: [`${base}/menu`], only: "1", apiKey: "bad", projectDir: project() })).rejects.toThrow(/Anthropic API 401/);
    expect(apiCalls).toBe(1);
  });

  it("writes the cache under the project's .tablefacts folder", async () => {
    const projectDir = project();
    anthropic(page("entradas", "$5.000"));
    await fetchImageMenu({ urls: [`${base}/menu`], only: "1", apiKey: "k", projectDir });
    const cache = join(projectDir, ".tablefacts", "cache");
    expect(existsSync(cache)).toBe(true);
    const files = readdirSync(join(cache, readdirSync(cache)[0]));
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
    expect(files.some((f) => f.endsWith(".png"))).toBe(true);
  });
});

describe("edge and playwright helpers", () => {
  it("cdpUp is true for a server answering /json/version and false otherwise", async () => {
    expect(await cdpUp(base)).toBe(true);
    expect(await cdpUp("http://127.0.0.1:1")).toBe(false);
  });

  it("ensureEdge returns at once when the browser is already up", async () => {
    await expect(ensureEdge(base)).resolves.toBeUndefined();
  });

  it("ensureEdge refuses to start a browser for a remote address", async () => {
    await expect(ensureEdge("http://example.invalid:9222")).rejects.toThrow("no browser answers at http://example.invalid:9222");
  });

  it("loadPlaywright returns the playwright module", async () => {
    expect(typeof (await loadPlaywright()).chromium.launch).toBe("function");
  });
});
