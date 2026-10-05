/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs modules without type declarations
import { research } from "../src/research/index.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { fetchText, MAX_BODY_BYTES } from "../src/research/lib/util.mjs";

afterEach(() => vi.unstubAllGlobals());

const stream = (chunks: Uint8Array[]) => {
  let i = 0;
  const cancel = vi.fn(async () => {});
  return { cancel, body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }), cancel }) } };
};
const res = (type: string, extra: any = {}, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  url: "https://example.com/x",
  headers: { get: (n: string) => (n === "content-type" ? type : headers[n] ?? null) },
  ...extra,
});

describe("fetchText body limits", () => {
  it("stops reading at 2 MB and returns the text as truncated, without an error", async () => {
    const chunk = new Uint8Array(512 * 1024).fill(97);
    const s = stream(Array.from({ length: 10 }, () => chunk));
    vi.stubGlobal("fetch", vi.fn(async () => res("text/html", s)));
    const r = await fetchText("https://example.com/x");
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_BODY_BYTES);
    expect(s.cancel).toHaveBeenCalled();
  });

  it("flags a declared content-length above the cap and reads no more than the cap", async () => {
    const s = stream([new Uint8Array(100).fill(98)]);
    vi.stubGlobal("fetch", vi.fn(async () => res("text/html", s, { "content-length": String(MAX_BODY_BYTES + 1) })));
    const r = await fetchText("https://example.com/x");
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(100);
  });

  it("does not flag a small body", async () => {
    const s = stream([new TextEncoder().encode("hola")]);
    vi.stubGlobal("fetch", vi.fn(async () => res("application/json", s)));
    expect(await fetchText("https://example.com/x")).toEqual({ ok: true, status: 200, url: "https://example.com/x", type: "application/json", text: "hola" });
  });

  it.each(["image/jpeg", "application/pdf", "application/zip", "video/mp4", "application/octet-stream"])("skips the body of %s", async (type) => {
    const text = vi.fn(async () => "never");
    vi.stubGlobal("fetch", vi.fn(async () => res(type, { text })));
    const r = await fetchText("https://example.com/x");
    expect(r).toMatchObject({ ok: true, text: "", skipped: true, type });
    expect(text).not.toHaveBeenCalled();
  });
});

describe("research() options and concurrency", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const out = () => {
    const d = mkdtempSync(join(tmpdir(), "tf-eff-"));
    dirs.push(d);
    return d;
  };
  const html = (body: string) => `<html><head><title>t</title></head><body>${body}<p>${"Open every day. ".repeat(40)}</p></body></html>`;
  const page = (body: string, url: string) => Object.defineProperty(new Response(html(body), { status: 200, headers: { "content-type": "text/html" } }), "url", { value: url });

  it("takes the Google key from `env` and never from process.env", async () => {
    const calls: { url: string; key?: string }[] = [];
    vi.stubGlobal("fetch", async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url, key: init?.headers?.["x-goog-api-key"] });
      if (url.includes("places.googleapis.com")) return new Response(JSON.stringify({ places: [] }), { status: 200 });
      return new Response("[]", { status: 200 });
    });
    const seen = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = "from-process";
    try {
      await research({ name: "La Casa", env: { GOOGLE_PLACES_API_KEY: "from-env" }, out: out() });
      expect(calls.find((c) => c.url.includes("places.googleapis.com"))?.key).toBe("from-env");
      calls.length = 0;
      const r = await research({ name: "La Casa", env: {}, out: out() });
      expect(calls.some((c) => c.url.includes("places.googleapis.com"))).toBe(false);
      expect(r.notes.join("\n")).toMatch(/Google Places: skipped/);
    } finally {
      if (seen === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = seen;
    }
  });

  it("resolves a relative `out` against projectDir", async () => {
    vi.stubGlobal("fetch", async () => new Response("[]", { status: 200 }));
    const project = out();
    const r = await research({ name: "La Casa", google: false, projectDir: project, out: "here/now" });
    expect(r.outDir).toBe(join(project, "here", "now"));
  });

  it("uses an optionError for a missing name", async () => {
    await expect(research({})).rejects.toMatchObject({ code: "EUSAGE", option: "name" });
  });

  it("starts Instagram, link-in-bio and TripAdvisor together and keeps the notes in the old order", async () => {
    const started: string[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    vi.stubGlobal("fetch", async (input: any) => {
      const url = String(input);
      if (url.startsWith("https://site.test")) return page('<a href="https://linktr.ee/casa">hub</a><a href="https://www.instagram.com/casa_mde/">ig</a>', url);
      if (url.includes("nominatim")) return new Response("[]", { status: 200 });
      if (url.includes("instagram.com")) {
        started.push("instagram");
        await delay(80);
        return new Response('<meta property="og:title" content="Casa (@casa_mde)"><meta property="og:description" content="1 Followers, 2 Following, 3 Posts - on Instagram: &quot;hi&quot;">', { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("linktr.ee")) {
        started.push("hub");
        await delay(10);
        return page("", url);
      }
      if (url.includes("tripadvisor")) {
        started.push("tripadvisor");
        return page("", url);
      }
      return new Response("no", { status: 404 });
    });
    const r = await research({ name: "La Casa", website: "https://site.test/", tripadvisor: "https://www.tripadvisor.com/Restaurant_Review-d1.html", google: false, out: out() });
    // all three were started before the slow Instagram answered
    expect([...started].sort()).toEqual(["hub", "instagram", "tripadvisor"]);
    const lines = r.notes.filter((n: string) => /^(Instagram|Link-in-bio|TripAdvisor)/.test(n));
    expect(lines.map((n: string) => n.split(/[ :]/)[0])).toEqual(["Instagram", "Link-in-bio", "TripAdvisor"]);
  });

  it("logs failed sources at the warn level and progress at info", async () => {
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    const lines: [string, string][] = [];
    await research({ name: "La Casa", env: { GOOGLE_PLACES_API_KEY: "k" }, out: out(), log: (m: string, l: string) => lines.push([m, l]) });
    expect(lines[0][1]).toBe("info");
    expect(lines.filter(([m]) => /failed/.test(m)).every(([, l]) => l === "warn")).toBe(true);
    expect(lines.some(([m]) => /Google Places: failed/.test(m))).toBe(true);
  });
});
