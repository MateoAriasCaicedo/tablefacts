/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// downloadInstagram() against a fake browser standing in for toolzu.com: the real flow (link reading,
// form submit, result scraping, click-to-save, direct fetch fallback, profile batches, retries) runs;
// only Playwright and Edge are replaced.

const state: any = {};
vi.mock("../src/lib/edge.mjs", () => ({ DEFAULT_CDP: "http://localhost:9222", ensureEdge: vi.fn(async () => {}) }));
vi.mock("../src/lib/playwright.mjs", () => ({
  loadPlaywright: async () => ({
    chromium: {
      launchPersistentContext: vi.fn(async () => state.context),
      connectOverCDP: async () => state.browser,
    },
  }),
}));

// @ts-expect-error plain .mjs modules without type declarations
import { downloadInstagram } from "../src/instagram/index.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { ensureEdge } from "../src/lib/edge.mjs";

const POST = "https://www.instagram.com/p/ABC123/";
const img = (n: number) => `https://scontent.cdninstagram.com/v/t51/pic${n}_n.jpg`;
const never = new Promise(() => {});

interface Opts {
  /** what the results page offers, per call of the page scrape */
  results?: Array<{ urls: string[]; buttons: boolean }>;
  /** photo cards on the profile page, one array per batch */
  batches?: string[][];
  rejected?: boolean;
}

function fakeToolzu({ results = [{ urls: [img(1), img(2)], buttons: true }], batches = [], rejected = false }: Opts = {}) {
  let scrape = 0;
  let batch = 0;
  let closed = false;
  const clicked: number[] = [];
  const page: any = {
    goto: vi.fn(async () => {}),
    url: () => "https://toolzu.com/downloader/instagram/photo/",
    fill: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    getByRole: () => ({ click: async () => {} }),
    getByText: () => ({ count: async () => 1 }),
    waitForResponse: vi.fn(async () => ({})),
    waitForSelector: vi.fn(async () => {}),
    waitForFunction: vi.fn(async () => {}),
    waitForEvent: vi.fn(async () => ({ saveAs: async (file: string) => writeFileSync(file, Buffer.alloc(100, 1)) })),
    waitForTimeout: vi.fn(async () => {}),
    content: vi.fn(async () => "<html></html>"),
    context: () => state.context,
    evaluate: vi.fn(async (fn: any) => {
      // profileImages() returns a list; findImages() an object
      if (String(fn).includes("fa-image")) return batches[Math.min(batch, batches.length - 1)] ?? [];
      return results[Math.min(scrape++, results.length - 1)];
    }),
    locator: (selector: string) => {
      const loc: any = {
        count: async () => (selector.includes("is-invalid") ? (rejected ? 1 : 0) : selector === "#viewer-next" ? (batch < batches.length - 1 ? 1 : 0) : 1),
        isVisible: async () => true,
        first: () => loc,
        nth: (i: number) => ({ dispatchEvent: async () => void clicked.push(i), click: async () => void clicked.push(i) }),
        getAttribute: async () => "href-1",
        click: async () => void batch++,
      };
      return loc;
    },
  };
  state.context = {
    pages: () => [page],
    newPage: async () => page,
    waitForEvent: () => never,
    close: vi.fn(async () => void (closed = true)),
    request: { get: async () => ({ ok: () => true, status: () => 200, headers: () => ({ "content-type": "image/jpeg" }), body: async () => Buffer.alloc(100, 2) }) },
  };
  state.browser = { contexts: () => [state.context], close: vi.fn(async () => {}) };
  return { page, clicked, isClosed: () => closed };
}

const dirs: string[] = [];
const out = () => {
  const d = mkdtempSync(join(tmpdir(), "tf-ig-"));
  dirs.push(d);
  return d;
};
beforeEach(() => vi.mocked(ensureEdge).mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe("downloadInstagram flow", () => {
  it("saves every image of a post by clicking each Download button", async () => {
    const { clicked, isClosed } = fakeToolzu();
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_profile") });
    expect(summary).toEqual({ saved: 2, skipped: 0, failed: [] });
    expect(readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort()).toEqual(["ABC123-1.jpg", "ABC123-2.jpg"]);
    expect(clicked).toEqual([0, 1]);
    expect(isClosed()).toBe(true);
  });

  it("a second run skips what is already saved", async () => {
    const dir = out();
    fakeToolzu();
    await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_p") });
    fakeToolzu();
    expect(await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_p") })).toEqual({ saved: 0, skipped: 2, failed: [] });
  });

  it("falls back to fetching the URL when the page has no Download buttons", async () => {
    fakeToolzu({ results: [{ urls: [img(7)], buttons: false }] });
    vi.stubGlobal("fetch", async () => new Response(Buffer.alloc(50, 3), { status: 200, headers: { "content-type": "image/jpeg" } }));
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_p") });
    expect(summary.saved).toBe(1);
  });

  it("records an HTTP failure of the direct fetch", async () => {
    fakeToolzu({ results: [{ urls: [img(7)], buttons: false }] });
    vi.stubGlobal("fetch", async () => new Response("no", { status: 403 }));
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_p") });
    expect(summary.failed).toEqual([{ item: POST, reason: "HTTP 403" }]);
  });

  it("keeps only image hosts and removes duplicates", async () => {
    fakeToolzu({ results: [{ urls: [img(1), img(1), "https://evil.example.com/x.jpg", "not a url"], buttons: true }] });
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, dryRun: true, userDataDir: join(dir, "_p") });
    expect(summary.found).toEqual([{ name: "ABC123-1.jpg", url: img(1) }]);
  });

  it("a dry run writes nothing", async () => {
    fakeToolzu();
    const dir = join(out(), "never");
    const summary = await downloadInstagram({ links: [POST], out: dir, dryRun: true, userDataDir: join(dir, "_p") });
    expect(summary.saved).toBe(0);
    expect(summary.found).toHaveLength(2);
    expect(existsSync(dir)).toBe(false);
  });

  it("retries once when the tool returns no images, then reports the failure", async () => {
    fakeToolzu({ results: [{ urls: [], buttons: true }] });
    const lines: string[] = [];
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_p"), log: (m: string) => lines.push(m) });
    expect(lines).toContain("  retrying (the tool returned no images)");
    expect(summary.failed).toEqual([{ item: POST, reason: "the tool returned no images" }]);
  });

  it("reads links from a file, ignoring comments and blank lines", async () => {
    fakeToolzu();
    const dir = out();
    const file = join(dir, "links.txt");
    writeFileSync(file, `# my posts\n\n${POST} # first\nhttps://www.instagram.com/p/XYZ789/\n${POST}\n`);
    const lines: string[] = [];
    const summary = await downloadInstagram({ file, out: dir, dryRun: true, userDataDir: join(dir, "_p"), log: (m: string) => lines.push(m) });
    expect(lines.filter((m) => m.startsWith("["))).toEqual([`[1/2] ${POST}`, "[2/2] https://www.instagram.com/p/XYZ789/"]);
    expect(summary.found).toHaveLength(4);
  });

  it("downloads a profile, following NEXT for several batches", async () => {
    fakeToolzu({ batches: [[img(1), img(2)], [img(3)]] });
    const dir = out();
    const summary = await downloadInstagram({ profile: "@cafe_mde", pages: 2, out: dir, userDataDir: join(dir, "_p") });
    expect(summary.failed).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.startsWith("cafe_mde-")).length).toBeGreaterThanOrEqual(2);
  });

  it("uses your own browser over CDP and closes only the tab it opened", async () => {
    const { page } = fakeToolzu();
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, cdp: "http://localhost:9222" });
    expect(ensureEdge).toHaveBeenCalledWith("http://localhost:9222", undefined);
    expect(summary.saved).toBe(2);
    expect(page.goto).toHaveBeenCalled();
    expect(state.context.close).not.toHaveBeenCalled();
    expect(state.browser.close).toHaveBeenCalled();
  });

  it("reports a post link that toolzu rejects, without throwing", async () => {
    fakeToolzu({ rejected: true });
    const dir = out();
    const summary = await downloadInstagram({ links: [POST], out: dir, userDataDir: join(dir, "_p") });
    expect(summary.saved).toBe(0);
    expect(summary.failed).toEqual([{ item: POST, reason: "toolzu did not accept the link" }]);
  });
});
