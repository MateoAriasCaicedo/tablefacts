/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// downloadTripadvisor() against a fake browser: the real page logic (check wait, carousel, slideshow,
// size fallback, skip, dry run, per-restaurant failure) runs; only Playwright and Edge are replaced.

const state: any = {};
vi.mock("../src/lib/edge.mjs", () => ({ DEFAULT_CDP: "http://localhost:9222", ensureEdge: vi.fn(async () => {}) }));
vi.mock("../src/lib/playwright.mjs", () => ({ loadPlaywright: async () => ({ chromium: { connectOverCDP: async () => state.browser } }) }));

// @ts-expect-error plain .mjs modules without type declarations
import { downloadTripadvisor } from "../src/tripadvisor/index.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { ensureEdge } from "../src/lib/edge.mjs";

const LINK = "https://www.tripadvisor.com/Restaurant_Review-g297478-d1234567-Reviews-La_Casa-Medellin.html";
const photoUrl = (n: number) => `https://dynamic-media-cdn.tripadvisor.com/media/photo-o/1a/2b/3c/4${n}/pic${n}.jpg`;
const jpeg = Buffer.alloc(8000, 7);

function fakeBrowser({ carousel = true, slides = [1, 2], gotoFails = false } = {}) {
  let slide = 0;
  const closed = { page: false, browser: false };
  const page: any = {
    goto: vi.fn(async () => {
      slide = 0;
      if (gotoFails) throw new Error("net::ERR_FAILED");
    }),
    // waitForCheck passes a selector argument; visibleSlides does not
    evaluate: vi.fn(async (_fn: unknown, arg?: unknown) => (arg !== undefined ? true : slides.slice(slide, slide + 1).map(photoUrl).join("\n"))),
    waitForFunction: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    content: vi.fn(async () => "<html></html>"),
    close: vi.fn(async () => void (closed.page = true)),
    keyboard: { press: vi.fn(async () => void slide++) },
    getByRole: () => ({ first: () => ({ click: async () => {} }) }),
    locator: () => ({
      first: () => ({ count: async () => (carousel ? 1 : 0), click: async () => {}, evaluate: async () => slides.map(photoUrl).join("\n") }),
    }),
  };
  const context: any = {
    newPage: async () => page,
    request: {
      get: async () => ({ ok: () => true, status: () => 200, headers: () => ({ "content-type": "image/jpeg" }), body: async () => jpeg }),
    },
  };
  state.browser = { contexts: () => [context], close: vi.fn(async () => void (closed.browser = true)) };
  return { page, context, closed };
}

const dirs: string[] = [];
const out = () => {
  const d = mkdtempSync(join(tmpdir(), "tf-ta-"));
  dirs.push(d);
  return d;
};
beforeEach(() => vi.mocked(ensureEdge).mockClear());
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("downloadTripadvisor flow", () => {
  it("steps through the slideshow and saves every photo", async () => {
    const { closed } = fakeBrowser({ slides: [1, 2, 3] });
    const dir = out();
    const lines: string[] = [];
    const summary = await downloadTripadvisor({ links: [LINK], out: dir, log: (m: string) => lines.push(m) });
    expect(summary).toEqual({ saved: 3, skipped: 0, failed: [] });
    expect(readdirSync(dir).filter((f) => f.startsWith("d1234567-"))).toHaveLength(3);
    expect(ensureEdge).toHaveBeenCalledOnce();
    expect(closed).toEqual({ page: true, browser: true });
    expect(lines).toContain("  photo slideshow opened");
  });

  it("a second run skips what is already saved", async () => {
    const dir = out();
    fakeBrowser({ slides: [1, 2] });
    await downloadTripadvisor({ links: [LINK], out: dir });
    fakeBrowser({ slides: [1, 2] });
    expect(await downloadTripadvisor({ links: [LINK], out: dir })).toEqual({ saved: 0, skipped: 2, failed: [] });
  });

  it("respects max", async () => {
    fakeBrowser({ slides: [1, 2, 3, 4] });
    const summary = await downloadTripadvisor({ links: [LINK], out: out(), max: 2 });
    expect(summary.saved).toBe(2);
  });

  it("a dry run lists the photos and writes nothing, not even the folder", async () => {
    fakeBrowser({ slides: [1, 2] });
    const dir = join(out(), "never");
    const summary = await downloadTripadvisor({ links: [LINK], out: dir, dryRun: true });
    expect(summary.saved).toBe(0);
    expect(summary.found).toHaveLength(2);
    expect(summary.found[0].url).toMatch(/^https:\/\/dynamic-media-cdn/);
    expect(existsSync(dir)).toBe(false);
  });

  it("without a carousel it reads the page markup only", async () => {
    fakeBrowser({ carousel: false, slides: [1] });
    const lines: string[] = [];
    const summary = await downloadTripadvisor({ links: [LINK], out: out(), log: (m: string) => lines.push(m) });
    expect(summary.saved).toBe(1);
    expect(lines).toContain("  no photo carousel found; reading nothing else on the page");
  });

  it("reports a photo that fails every size, and keeps going", async () => {
    const { context } = fakeBrowser({ slides: [1] });
    context.request.get = async () => ({ ok: () => false, status: () => 404, headers: () => ({}), body: async () => Buffer.alloc(0) });
    const summary = await downloadTripadvisor({ links: [LINK], out: out() });
    expect(summary.saved).toBe(0);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].reason).toBe("HTTP 404");
  });

  it("rejects non-image and tiny responses", async () => {
    const { context } = fakeBrowser({ slides: [1, 2] });
    let n = 0;
    context.request.get = async () => {
      n++;
      const html = n <= 4;
      return { ok: () => true, status: () => 200, headers: () => ({ "content-type": html ? "text/html" : "image/jpeg" }), body: async () => Buffer.alloc(10) };
    };
    const summary = await downloadTripadvisor({ links: [LINK], out: out() });
    expect(summary.saved).toBe(0);
    expect(summary.failed.map((f: any) => f.reason).every((r: string) => ["not an image", "not an image (text/html)", "too small"].includes(r))).toBe(true);
  });

  it("a restaurant that fails is recorded and the browser still closes", async () => {
    const { closed } = fakeBrowser({ gotoFails: true });
    const summary = await downloadTripadvisor({ links: [LINK], out: out() });
    expect(summary.failed).toEqual([{ item: LINK, reason: "net::ERR_FAILED" }]);
    expect(closed).toEqual({ page: true, browser: true });
  });

  it("reports when no photos are found", async () => {
    fakeBrowser({ carousel: true, slides: [] });
    const summary = await downloadTripadvisor({ links: [LINK], out: out() });
    expect(summary.failed[0].reason).toMatch(/no photos found/);
  });

  it("writes the page html with debug", async () => {
    fakeBrowser({ slides: [1] });
    const dir = out();
    await downloadTripadvisor({ links: [LINK], out: dir, debug: true });
    expect(existsSync(join(dir, "_debug", "d1234567.html"))).toBe(true);
  });

  it("handles several restaurants and logs skipped bad links at the error level", async () => {
    fakeBrowser({ slides: [1] });
    const lines: Array<[string, string?]> = [];
    const second = LINK.replace("d1234567", "d7654321");
    const summary = await downloadTripadvisor({ links: [LINK, "https://example.com/x", second], out: out(), log: (m: string, l?: string) => lines.push([m, l]) });
    expect(summary.saved).toBe(2);
    expect(lines).toContainEqual(["Skipping, not a TripAdvisor restaurant link: https://example.com/x", "warn"]);
  });
});
